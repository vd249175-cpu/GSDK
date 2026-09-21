export default {
  id: 'example.os-recorder-run',
  contribute(run) {
    run.backendPlugin({
      id: 'example.os-recorder',
      path: './plugins/backend/os-recorder',
    });
    run.backendPlugin({
      id: 'example.ufo-computer-control',
      path: './plugins/backend/ufo-computer-control',
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
    run.graph({
      id: 'computer',
      plugin: 'example.ufo-computer-control',
      factory: 'createUfoComputerControlGraph',
    });
    run.frontend({
      id: 'recorder-ui',
      plugin: 'example.os-recorder',
      graph: 'recorder',
    });
  },
};
