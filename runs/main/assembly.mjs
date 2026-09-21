export default {
  id: 'main.assembly',
  contribute(run) {
    // Backend plugins
    run.backendPlugin({
      id: 'example.unified-recorder',
      path: '../../app/plugins/backend/unified-recorder',
    });
    run.backendPlugin({
      id: 'example.browser-recorder',
      path: '../../app/plugins/backend/browser-recorder',
    });
    run.backendPlugin({
      id: 'example.os-recorder',
      path: '../../app/plugins/backend/os-recorder',
    });
    run.backendPlugin({
      id: 'example.ufo-computer-control',
      path: '../../app/plugins/backend/ufo-computer-control',
    });

    // Frontend plugins
    run.frontendPlugin({
      id: 'example.unified-recorder',
      path: '../../app/plugins/frontend/unified-recorder',
    });

    // Graph instances
    run.graph({
      id: 'recorder',
      plugin: 'example.unified-recorder',
      factory: 'createUnifiedRecorderGraph',
    });
    run.graph({
      id: 'browser-recorder',
      plugin: 'example.browser-recorder',
      factory: 'createBrowserRecorderGraph',
    });
    run.graph({
      id: 'os-recorder',
      plugin: 'example.os-recorder',
      factory: 'createOsRecorderGraph',
    });
    run.graph({
      id: 'computer',
      plugin: 'example.ufo-computer-control',
      factory: 'createUfoComputerControlGraph',
    });

    // Frontend instances — 统一录制主页面
    run.frontend({
      id: 'main-ui',
      plugin: 'example.unified-recorder',
      graph: 'recorder',
    });

    run.requireNode('recorder/session');
    run.requireNode('browser-recorder/session');
    run.requireNode('os-recorder/session');
    run.requireNode('computer/session');
  },
};
