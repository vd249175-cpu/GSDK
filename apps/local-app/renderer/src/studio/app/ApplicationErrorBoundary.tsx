import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ApplicationErrorBoundaryProps {
  children: ReactNode
}

interface ApplicationErrorBoundaryState {
  error: string
}

export class ApplicationErrorBoundary extends Component<
  ApplicationErrorBoundaryProps,
  ApplicationErrorBoundaryState
> {
  state: ApplicationErrorBoundaryState = { error: '' }

  static getDerivedStateFromError(error: unknown): ApplicationErrorBoundaryState {
    return {
      error: error instanceof Error ? error.message : 'Renderer 发生未知错误',
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('GraphVideo Renderer 渲染失败', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <main className="application-crash-screen" role="alert">
          <strong>GraphVideo 无法完成界面渲染</strong>
          <span>{this.state.error}</span>
          <small>请保留该信息并重新启动应用。</small>
        </main>
      )
    }
    return this.props.children
  }
}
