export default {
  id: 'example.counter-run',
  contribute(run) {
    run.backendPlugin({
      id: 'example.hello-counter',
      path: '../../app/plugins/backend/hello-counter',
    });
    run.node({
      id: 'example.counter',
      plugin: 'example.hello-counter',
      factory: 'createCounterNode',
    });
  },
};
