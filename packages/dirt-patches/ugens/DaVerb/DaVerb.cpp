#include "SC_PlugIn.hpp"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>

static InterfaceTable* ft;

namespace {

constexpr int kNumLines = 12;
constexpr int kNumTaps = 14;

constexpr double kLineSeconds[kNumLines] = {
    0.004771345, 0.003595309, 0.012734787, 0.009307483, 0.022579886, 0.149625349,
    0.060481839, 0.1249958,   0.030509727, 0.141695508, 0.089244313, 0.106280031,
};

constexpr double kTapSeconds[kNumTaps] = {
    0.008937872, 0.099929438, 0.064278754, 0.067067639, 0.066866033, 0.006283391, 0.035818689,
    0.011861161, 0.121870905, 0.041262054, 0.08981553,  0.070931756, 0.011256342, 0.004065724,
};

constexpr double kTwoPiA = 6.28;
constexpr double kTwoPiB = 6.2847;
constexpr float kWetGain = 0.6f;

uint32_t ceilPow2(uint32_t n) {
    uint32_t size = 1;
    while (size < n)
        size <<= 1;
    return size;
}

struct DelayLine {
    float* buffer;
    uint32_t mask;
    uint32_t writeOffset;
};

struct Rotor {
    double re = 1.0, im = 0.0;
    double stepRe = 1.0, stepIm = 0.0;

    void setStep(double radians) {
        stepRe = std::cos(radians);
        stepIm = std::sin(radians);
    }

    void advance() {
        const double nextRe = re * stepRe - im * stepIm;
        im = re * stepIm + im * stepRe;
        re = nextRe;
    }

    void renormalize() {
        const double gain = 1.0 / std::sqrt(re * re + im * im);
        re *= gain;
        im *= gain;
    }
};

}

class DaVerb : public SCUnit {
public:
    DaVerb() {
        const double sampleRate = this->sampleRate();
        uint32_t lengths[kNumLines];
        uint32_t total = 0;
        for (int i = 0; i < kNumLines; ++i) {
            lengths[i] = static_cast<uint32_t>(std::lround(kLineSeconds[i] * sampleRate));
            total += ceilPow2(lengths[i]);
        }
        mMaxPreDelay = static_cast<uint32_t>(sampleRate) - 1;
        const uint32_t preDelaySize = ceilPow2(mMaxPreDelay + 1);
        total += preDelaySize;

        mMemorySize = total;
        mMemory = static_cast<float*>(RTAlloc(mWorld, total * sizeof(float)));
        Unit* unit = this;
        ClearUnitIfMemFailed(mMemory);

        float* cursor = mMemory;
        for (int i = 0; i < kNumLines; ++i) {
            const uint32_t size = ceilPow2(lengths[i]);
            mLines[i] = { cursor, size - 1, lengths[i] - 1 };
            cursor += size;
        }
        mPreDelay = cursor;
        mPreDelayMask = preDelaySize - 1;

        for (int i = 0; i < kNumTaps; ++i)
            mTaps[i] = static_cast<uint32_t>(std::lround(kTapSeconds[i] * sampleRate));

        set_calc_function<DaVerb, &DaVerb::next>();
        reset();
    }

    ~DaVerb() {
        if (mMemory)
            RTFree(mWorld, mMemory);
    }

private:
    enum Inputs {
        Input,
        Decay,
        Damping,
        Bandwidth,
        PreDelay,
        ExcursionRate,
        ExcursionDepth,
        InputDiffusion1,
        InputDiffusion2,
        DecayDiffusion1,
        DecayDiffusion2,
    };

    float* mMemory = nullptr;
    uint32_t mMemorySize = 0;
    DelayLine mLines[kNumLines];
    uint32_t mTaps[kNumTaps];
    float* mPreDelay = nullptr;
    uint32_t mPreDelayMask = 0;
    uint32_t mMaxPreDelay = 0;
    uint32_t mTime = 0;
    float mInputLowpass = 0.f;
    float mDampingA = 0.f;
    float mDampingB = 0.f;
    Rotor mLfoA;
    Rotor mLfoB;

    void reset() {
        std::memset(mMemory, 0, mMemorySize * sizeof(float));
        mTime = 0;
        mInputLowpass = mDampingA = mDampingB = 0.f;
        mLfoA = Rotor();
        mLfoB = Rotor();
    }

    float param(int index, float lo, float hi) const { return sc_clip(in0(index), lo, hi); }

    float read(int line) const {
        const DelayLine& d = mLines[line];
        return d.buffer[mTime & d.mask];
    }

    float readAt(int line, uint32_t offset) const {
        const DelayLine& d = mLines[line];
        return d.buffer[(mTime + offset) & d.mask];
    }

    float readCubic(int line, float offset) const {
        const DelayLine& d = mLines[line];
        const uint32_t whole = static_cast<uint32_t>(offset);
        const float frac = offset - static_cast<float>(whole);
        const uint32_t base = mTime + whole - 1;
        const float x0 = d.buffer[base & d.mask];
        const float x1 = d.buffer[(base + 1) & d.mask];
        const float x2 = d.buffer[(base + 2) & d.mask];
        const float x3 = d.buffer[(base + 3) & d.mask];
        const float a = (3.f * (x1 - x2) - x0 + x3) * 0.5f;
        const float b = 2.f * x2 + x0 - (5.f * x1 + x3) * 0.5f;
        const float c = (x2 - x0) * 0.5f;
        return ((a * frac + b) * frac + c) * frac + x1;
    }

    float write(int line, float value) {
        const DelayLine& d = mLines[line];
        d.buffer[(mTime + d.writeOffset) & d.mask] = value;
        return value;
    }

    void next(int nSamples) {
        const double sampleRate = this->sampleRate();
        const uint32_t pd =
            std::min(static_cast<uint32_t>(std::lround(std::max(in0(PreDelay), 0.f) * sampleRate)), mMaxPreDelay);
        const float bw = param(Bandwidth, 0.f, 1.f);
        const float fi = param(InputDiffusion1, 0.f, 1.f);
        const float si = param(InputDiffusion2, 0.f, 1.f);
        const float dc = param(Decay, 0.f, 1.f);
        const float ft = param(DecayDiffusion1, 0.f, 0.999999f);
        const float st = param(DecayDiffusion2, 0.f, 0.999999f);
        const float dp = 1.f - param(Damping, 0.f, 1.f);
        const double ex = param(ExcursionRate, 0.f, 2.f) / sampleRate;
        const float ed = param(ExcursionDepth, 0.f, 2.f) * static_cast<float>(sampleRate) / 1000.f;
        mLfoA.setStep(ex * kTwoPiA);
        mLfoB.setStep(ex * kTwoPiB);

        const float* input = in(Input);
        float* left = out(0);
        float* right = out(1);

        for (int i = 0; i < nSamples; ++i) {
            mPreDelay[mTime & mPreDelayMask] = input[i];
            mInputLowpass += bw * (mPreDelay[(mTime - pd) & mPreDelayMask] - mInputLowpass);

            float pre = write(0, mInputLowpass - fi * read(0));
            pre = write(1, fi * (pre - read(1)) + read(0));
            pre = write(2, fi * pre + read(1) - si * read(2));
            pre = write(3, si * (pre - read(3)) + read(2));
            const float split = si * pre + read(3);

            const float excA = ed * (1.f + static_cast<float>(mLfoA.re));
            const float excB = ed * (1.f + static_cast<float>(mLfoB.im));

            const float modA = readCubic(4, excA);
            float temp = write(4, split + dc * read(11) + ft * modA);
            write(5, modA - ft * temp);
            mDampingA += dp * (read(5) - mDampingA);
            temp = write(6, dc * mDampingA - st * read(6));
            write(7, read(6) + st * temp);

            const float modB = readCubic(8, excB);
            temp = write(8, split + dc * read(7) + ft * modB);
            write(9, modB - ft * temp);
            mDampingB += dp * (read(9) - mDampingB);
            temp = write(10, dc * mDampingB - st * read(10));
            write(11, read(10) + st * temp);

            const float lo = readAt(9, mTaps[0]) + readAt(9, mTaps[1]) - readAt(10, mTaps[2])
                + readAt(11, mTaps[3]) - readAt(5, mTaps[4]) - readAt(6, mTaps[5]) - readAt(7, mTaps[6]);
            const float ro = readAt(5, mTaps[7]) + readAt(5, mTaps[8]) - readAt(6, mTaps[9])
                + readAt(7, mTaps[10]) - readAt(9, mTaps[11]) - readAt(10, mTaps[12]) - readAt(11, mTaps[13]);
            left[i] = lo * kWetGain;
            right[i] = ro * kWetGain;

            mLfoA.advance();
            mLfoB.advance();
            ++mTime;
        }

        mLfoA.renormalize();
        mLfoB.renormalize();
        mInputLowpass = zapgremlins(mInputLowpass);
        mDampingA = zapgremlins(mDampingA);
        mDampingB = zapgremlins(mDampingB);
    }
};

PluginLoad(DaVerbUGens) {
    ft = inTable;
    registerUnit<DaVerb>(ft, "DaVerb", true);
}
