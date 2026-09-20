export default {
  id: 'example.os-recorder-run',
  contribute(run) {
    run.backendPlugin({
      id: 'example.os-recorder',
      path: '../../app/plugins/backend/os-recorder',
    });
    run.graph({
      id: 'recorder',
      plugin: 'example.os-recorder',
      factory: 'createOsRecorderGraph',
    });
    run.requireNode('recorder/session');
  },
};
