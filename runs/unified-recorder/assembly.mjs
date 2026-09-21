export default {
  id: 'example.unified-recorder-run',
  contribute(run) {
    run.backendPlugin({
      id: 'example.unified-recorder',
      path: './plugins/backend/unified-recorder',
    });
    run.frontendPlugin({
      id: 'example.unified-recorder',
      path: './plugins/frontend/unified-recorder',
    });
    run.graph({
      id: 'recorder',
      plugin: 'example.unified-recorder',
      factory: 'createUnifiedRecorderGraph',
    });
    run.frontend({
      id: 'recorder-ui',
      plugin: 'example.unified-recorder',
      graph: 'recorder',
    });
  },
};
