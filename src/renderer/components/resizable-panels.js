/**
 * Компонент изменяемых размеров панелей
 */

import { $ } from '../utils/dom.js';

export class ResizablePanels {
  constructor() {
    this._setupResizer('resizer-left', (dx) => {
      const sidebar = $('sidebar');
      const newW = Math.max(140, Math.min(520, sidebar.offsetWidth + dx));
      sidebar.style.width = newW + 'px';
    });

    this._setupResizer('resizer-right', (dx) => {
      const cp = $('code-panel');
      const newW = Math.max(200, Math.min(900, cp.offsetWidth - dx));
      cp.style.width = newW + 'px';
    });
  }

  _setupResizer(resizerId, onDelta) {
    const el = $(resizerId);
    if (!el) return;
    
    let startX = 0;
    
    el.addEventListener('mousedown', (e) => {
      startX = e.clientX;
      el.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.body.style.pointerEvents = 'none';
      el.style.pointerEvents = 'auto';

      const onMove = (e) => {
        onDelta(e.clientX - startX);
        startX = e.clientX;
      };
      
      const onUp = () => {
        el.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.body.style.pointerEvents = '';
        el.style.pointerEvents = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}
