export default {
  id: 'demo.main',
  contribute(run) {
    run.backendPlugin({
      id: 'demo.topology',
      path: '../../app/plugins/backend/demo-topology',
    });
    run.frontendPlugin({
      id: 'demo.topology',
      path: '../../app/plugins/frontend/demo-topology',
    });
    run.graph({
      id: 'topology',
      plugin: 'demo.topology',
      factory: 'createDemoTopologyGraph',
    });
    run.frontend({
      id: 'demo-ui',
      plugin: 'demo.topology',
      graph: 'topology',
    });
    run.requireNode('topology/orders');
  },
};
