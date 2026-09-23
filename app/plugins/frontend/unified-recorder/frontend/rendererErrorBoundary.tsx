import { Component, type ErrorInfo, type PropsWithChildren } from 'react'

type State = { error: Error | null }

export class RendererErrorBoundary extends Component<PropsWithChildren, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Recorder renderer failed]', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <main className="renderer-failure" role="alert">
          <h1>录制界面暂时无法显示</h1>
          <p>请先确认录制状态。界面渲染失败不会自动停止后端录制。</p>
          <code>{this.state.error.message}</code>
          <button type="button" onClick={() => this.setState({ error: null })}>重试界面</button>
        </main>
      )
    }
    return this.props.children
  }
}
