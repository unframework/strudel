# strudel

Live coding patterns on the web


- Try it here: <https://strudel.cc>
- Docs: <https://strudel.cc/learn>
- Source: https://codeberg.org/uzu/strudel/
  * Along with many other live coding projects, we have moved from Microsoft's Github platform to Codeberg for ethical reasons. **Please don't fork the project back to github**.
- Technical Blog Post: <https://loophole-letters.vercel.app/strudel>
- 1 Year of Strudel Blog Post: <https://loophole-letters.vercel.app/strudel1year>
- 2 Years of Strudel Blog Post: <https://strudel.cc/blog/#year-2>


## Offline Rendering

Render a sketch to a looping WAV + video with animated code highlights:

```bash
python packages/render/loop.py -i my-sketch.js --cycles 8
```

## Running Locally

After cloning the project, you can run the REPL locally:

1. Install [Node.js](https://nodejs.org/) 18 or newer
2. Install [pnpm](https://pnpm.io/installation)
3. Install dependencies by running the following command:
   ```bash
   pnpm i
   ```
4. Run the development server:
   ```bash
   pnpm dev
   ```

## Restacking onto upstream

This fork maintains several `nm/*` feature branches that are periodically rebased onto `upstream/main`. The `restack.py` script automates this.

```bash
# ensure upstream remote is set
git remote add upstream ssh://git@codeberg.org/uzu/strudel.git

# Fresh restack (creates tmp/YYYYMMDD/ refs)
python3 restack.py

# Resume after resolving a conflict
python3 restack.py tmp/20260315

# Clear out old tmp refs
for ref in $(git for-each-ref refs/heads/tmp/ --format='%(refname)'); do git update-ref -d "$ref"; done
```

## Using Strudel In Your Project

This project is organized into many [packages](./packages), which are also available on [npm](https://www.npmjs.com/search?q=%40strudel).

Read more about how to use these in your own project [here](https://strudel.cc/technical-manual/project-start).

You will need to abide by the terms of the [GNU Affero Public Licence v3](LICENSE). As such, Strudel code can only be shared within free/open source projects under the same license -- see the license for details.

Licensing info for the default sound banks can be found over on the [dough-samples](https://github.com/felixroos/dough-samples/blob/main/README.md) repository.

## Deploy

```
pnpm build
(cd cdk-infra && AWS_PROFILE=nm pnpm cdk deploy)
```

## Contributing

There are many ways to contribute to this project! See [contribution guide](./CONTRIBUTING.md). You can find the full list of contributors [here](https://codeberg.org/uzu/strudel/activity/contributors).

## Community

There is a #strudel channel on the TidalCycles discord: <https://discord.com/invite/HGEdXmRkzT>

You can also ask questions and find related discussions on the tidal club forum: <https://club.tidalcycles.org/>

The discord and forum is shared with the haskell (tidal) and python (vortex) siblings of this project.

We also have a mastodon account: <a rel="me" href="https://social.toplap.org/@strudel">social.toplap.org/@strudel</a>
