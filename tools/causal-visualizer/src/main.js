import { jsx as _jsx } from "react/jsx-runtime";
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { VisualizerApp } from './VisualizerApp';
import './visualizer.css';
createRoot(document.getElementById('root')).render(_jsx(StrictMode, { children: _jsx(VisualizerApp, {}) }));
