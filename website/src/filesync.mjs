import { nanoid } from 'nanoid';

function initRPCSink() {
  const rpcCallId = `strudel-rpc-${nanoid()}`;
  const promise = new Promise((resolve, reject) => {
    const listener = async ({ data }) => {
      if (!data || data.namespace !== 'strudel-main' || data.type !== 'rpcResponse') {
        return;
      }

      if (data.id === rpcCallId) {
        window.removeEventListener('message', listener);
        resolve(data.response);
      }
    };

    window.addEventListener('message', listener);
    setTimeout(() => {
      // always just clean up after 30 seconds
      window.removeEventListener('message', listener);
      reject(new Error(`RPC call ${rpcCallId} timed out`));
    }, 5000);
  });

  return { promise, id: rpcCallId };
}

export async function saveFilesyncExtPattern(id, data) {
  if (data === null) {
    window.postMessage?.(
      {
        namespace: 'strudel-filesync-ext',
        type: 'userPatternDeleted',
        id,
      },
      window.origin,
    );
    return;
  }

  window.postMessage?.(
    {
      namespace: 'strudel-filesync-ext',
      type: 'userPatternUpdated',
      data,
    },
    window.origin,
  );
}

export async function loadFilesyncExtData() {
  if (!document.body.classList.contains('strudel-filesync-ext-active')) {
    console.log('filesync-ext: extension not active, skipping load');
    return {};
  }

  const { promise, id } = initRPCSink();
  window.postMessage(
    {
      namespace: 'strudel-filesync-ext',
      type: 'load',
      rpcCallId: id,
    },
    window.origin,
  );

  try {
    const codeUpdates = await promise;
    console.log('filesync-ext: received code updates from filesync-ext', codeUpdates);

    return codeUpdates;
  } catch (err) {
    console.error('filesync-ext: error receiving code updates from filesync-ext', err);
    return {};
  }
}
