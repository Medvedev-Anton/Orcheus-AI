/**
 * Компонент дерева файлов
 */

import { $ } from '../utils/dom.js';
import { shortenPath } from '../utils/format.js';
import { fileIcon } from '../../shared/utils.js';

export class FileTree {
  constructor(appState) {
    this.state = appState;
    
    this.elFileTree = $('file-tree');
    this.elStRoot = $('st-root');
    this.elStCount = $('st-count');
    this.elPathLabel = $('project-path-label');
    
    this._bindEvents();
  }

  _bindEvents() {
    $('btn-refresh').addEventListener('click', () => this.refresh());
    $('btn-open-folder').addEventListener('click', () => window.api.openFolder());
  }

  async refresh() {
    const result = await window.api.listFiles();

    this.elFileTree.innerHTML = '';
    this.elStRoot.textContent = '';
    this.elStCount.textContent = '';
    this.elPathLabel.textContent = result.root || '';

    if (!result.ok || !result.tree || result.tree.length === 0) {
      this.elFileTree.innerHTML = '<p class="hint-text">Файлы появятся здесь после первой генерации</p>';
      return;
    }

    let fileCount = 0;
    this._renderNodes(result.tree, this.elFileTree, 0, fileCount);

    this.elStRoot.textContent = shortenPath(result.root, 40);
    this.elStCount.textContent = `${fileCount} файл(ов)`;
  }

  _renderNodes(nodes, container, depth, fileCount) {
    for (const node of nodes) {
      const item = document.createElement('div');
      item.className = `t-node ${node.type === 'dir' ? 't-dir' : 't-file'}`;
      item.style.paddingLeft = `${depth * 14 + 8}px`;
      item.tabIndex = 0;

      const icon = document.createElement('span');
      icon.className = 't-icon';

      const label = document.createElement('span');
      label.className = 't-label';
      label.textContent = node.name;

      item.appendChild(icon);
      item.appendChild(label);

      if (node.type === 'dir') {
        icon.textContent = '📂';
        container.appendChild(item);

        const childWrap = document.createElement('div');
        container.appendChild(childWrap);

        let open = true;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          open = !open;
          icon.textContent = open ? '📂' : '📁';
          childWrap.style.display = open ? '' : 'none';
        });

        if (node.children && node.children.length > 0) {
          this._renderNodes(node.children, childWrap, depth + 1, fileCount);
        }
      } else {
        fileCount.value++;
        icon.textContent = fileIcon(node.name);
        item.title = node.fullPath;

        item.addEventListener('click', async () => {
          document.querySelectorAll('.t-node.active').forEach((e) => e.classList.remove('active'));
          item.classList.add('active');
          
          window.dispatchEvent(new CustomEvent('open-file', { 
            detail: { fullPath: node.fullPath, name: node.name } 
          }));
        });

        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') item.click();
        });

        container.appendChild(item);
      }
    }
  }
}
