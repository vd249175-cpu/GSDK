export default {
  id: 'example.os-recorder-run',
  contribute(run) {
    run.backendPlugin({
      id: 'example.os-recorder',
      path: './plugins/backend/os-recorder',
    });
    run.frontendPlugin({
      id: 'example.os-recorder',
      path: './plugins/frontend/os-recorder',
    });
    run.graph({
      id: 'recorder',
      plugin: 'example.os-recorder',
      factory: 'createOsRecorderGraph',
    });
    run.frontend({
      id: 'recorder-ui',
      plugin: 'example.os-recorder',
      graph: 'recorder',
    });
  },
};
