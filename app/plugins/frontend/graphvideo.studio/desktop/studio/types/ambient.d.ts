import '@graphvideo/kernel';

declare module '@graphvideo/kernel' {
  interface Node {
    icon: string;
    description: string;
    category: string;
    subtitle: string;
  }
}
