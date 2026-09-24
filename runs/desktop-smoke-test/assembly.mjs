export default {
  id: 'desktop-smoke-test.main',
  contribute(run) {
    run.backendPlugin({
      id: 'test.desktop-smoke-test',
      path: './plugins/backend/desktop-smoke-test',
    });
    run.backendPlugin({
      id: 'example.ufo-computer-control',
      path: '../../app/plugins/backend/ufo-computer-control',
    });
    run.backendPlugin({
      id: 'example.browser-executor',
      path: '../../app/plugins/backend/browser-executor',
    });
    run.backendPlugin({ id: 'example.agent-executor', path: '../../app/plugins/backend/agent-executor' });
    run.backendPlugin({ id: 'example.agent-monitor', path: '../../app/plugins/backend/agent-monitor' });
    run.frontendPlugin({
      id: 'test.workflow-observer',
      path: './plugins/frontend/workflow-observer',
    });
    run.graph({
      id: 'smoke',
      plugin: 'test.desktop-smoke-test',
      factory: 'createDesktopSmokeTestGraph',
    });
    run.graph({
      id: 'computer',
      plugin: 'example.ufo-computer-control',
      factory: 'createUfoComputerControlGraph',
    });
    run.graph({ id: 'browser', plugin: 'example.browser-executor', factory: 'createBrowserExecutorGraph' });
    run.graph({ id: 'agent', plugin: 'example.agent-executor', factory: 'createAgentExecutorGraph',
      params: { promptSections: ['You are the GraphFramework workflow review agent. Ask the user before signaling a save decision.'] } });
    run.graph({ id: 'monitor', plugin: 'example.agent-monitor', factory: 'createAgentMonitorGraph' });
    run.frontend({
      id: 'observer-ui',
      plugin: 'test.workflow-observer',
      graph: 'smoke',
    });
    run.requireNode('smoke/session');
    run.requireNode('smoke/entry');
    run.requireNode('smoke/world-review');
    run.requireNode('computer/session');
    run.requireNode('computer/request');
    run.requireNode('browser/session');
    run.requireNode('agent/session');
    run.requireNode('monitor/session');
  },
};
