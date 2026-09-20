export default {
  id: 'example.browser-recorder-run',
  contribute(run) {
    run.backendPlugin({
      id: 'example.browser-recorder',
      path: '../../app/plugins/backend/browser-recorder',
    });
    run.graph({
      id: 'recorder',
      plugin: 'example.browser-recorder',
      factory: 'createBrowserRecorderGraph',
    });
  },
};
