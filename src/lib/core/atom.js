import {
  initiateStyleSheet,
  processComponentMarkup,
  addToReactiveCache,
  setupEventDelegation
} from '../dom/utils.js';
import { components } from '../internal.js';
import { createSignal } from '../reactivity/signal.js';
import { addIndexToTemplate, initiateComponents, initiateWidgets, initiateExtendedWidgets, lintPlaceholders } from '../parser/utils.js';

function _set(index, value, shallow) {
  if (!this.isReactive) {
    throw new Error(`Valen:\nCannot call 'set()' on Atom ${this.name}.\n\n${this.name} is not a reactive Atom`);
  }
  if (typeof index === "number") {
    if (value && typeof value === "object") {
      if (shallow) {
        const keys = Object.keys(value);
        for (let i = 0; i < keys.length; i++) {
          this.state[index][keys[i]] = value[keys[i]];
        }
      } else {
        this.state[index] = value;
      }
    }
  } else if (Array.isArray(index)) {
    for (let i = 0; i < index.length; i++) {
      this.state[i] = index[i];
    }
  } else {
    console.warn(`Valen:\nFirst Argument passed to '${this.name}.set()' must either be a number or an array.`);
  }
}

export default function Atom(activatorFunc) {
  const options = activatorFunc();
  const id = options.id,
    name = activatorFunc.name;
  
  let _element = id;
  const _name = name;
  const _template = options.template;
  let _state = [];
  const _useStrict = true;
  const _isReactive = options.isReactive;
  
  const setFunc = _isReactive ? _set : () => console.warn(`Cannot call set on Atom '${_name}'. Make sure 'isReactive' is set to true.`);
  
  const instance = {
    stylesheet: options.stylesheet,
    dependencyMap: _isReactive ? new Map() : undefined,
    
    _getElement() {
      if (typeof _element === "string") {
        const resolvedNode = document.getElementById(_element);
        if (!resolvedNode) {
          throw new Error(`Valen:\nMount node of '${_name}' is invalid or not provided`);
        }
        _element = resolvedNode;
      }
      return _element;
    },
    
    destroy() {
      const el = this._getElement();
      if (!el) return;
      const allNodes = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
      let node = walker.currentNode;
      while (node) {
        allNodes.push(node);
        node = walker.nextNode();
      }
      removeEvents(allNodes);
      el.replaceChildren();
      _state = [];
    },
    
    renderWith(data, position = "append") {
      if (!data || typeof data !== "object") {
        throw new Error(
          `Valen:\nFirst argument of '${_name}.renderWith()' must either be an object or an array.`
        );
      }
      const el = this._getElement();
      const dataArray = Array.isArray(data) ? data : [data];
      if (dataArray.length === 0) return;
      const dataLen = _state.length;
      _state = createSignal(dataArray.slice(), instance);
      return new Promise((resolve, reject) => {
        const isTemplateFunc = typeof _template === "function";
        
        const masterFragment = document.createDocumentFragment();
        let currentIndex = dataLen;
        const BATCH_SIZE = 30;
        
        const processBatch = () => {
          const end = Math.min(currentIndex + BATCH_SIZE, dataArray.length);
          
          if (_isReactive) {
            for (let i = currentIndex; i < end; i++) {
              const itemHTML = isTemplateFunc ? _template(dataArray[i], i) : _template;
              const indexedHTML = addIndexToTemplate(itemHTML, i);
              const componentHTML = initiateComponents(indexedHTML, false, true);
              const frag = processComponentMarkup(componentHTML, instance, _name);
              
              // Safely capture the nodes into the master fragment immediately
              if (frag) masterFragment.appendChild(frag);
            }
          } else {
            for (let i = currentIndex; i < end; i++) {
              const itemHTML = isTemplateFunc ? _template(dataArray[i], i) : _template;
              const indexedHTML = addIndexToTemplate(itemHTML, i, instance);
              const widgetHTML = initiateExtendedWidgets(initiateWidgets(indexedHTML));
              const lintedHTML = lintPlaceholders(widgetHTML, true);
              const frag = processComponentMarkup(lintedHTML, instance, _name);
              
              if (frag) masterFragment.appendChild(frag);
            }
          }
          
          currentIndex = end;
          
          if (currentIndex < dataArray.length) {
            requestAnimationFrame(processBatch);
          } else {
            // All items processed – mount everything cleanly in a single paint operation
            try {
              if (position === "append") {
                el.appendChild(masterFragment);
              } else {
                el.prepend(masterFragment);
              }
              addToReactiveCache(el);
              setupEventDelegation(el, this);
              resolve();
            } catch (err) {
              reject(err);
            }
          }
        };
        requestAnimationFrame(processBatch);
      });
    },
    set: setFunc
  };
  
  Object.defineProperties(instance, {
    element: { get: () => _element, configurable: true },
    name: { get: () => _name, configurable: true },
    template: { get: () => _template, configurable: true },
    state: { get: () => _state, configurable: true },
    useStrict: { get: () => _useStrict, configurable: true },
    isReactive: { get: () => _isReactive, configurable: true },
    type: { get: () => "Atom", configurable: true }
  });
  
  initiateStyleSheet(`#${id}`, instance);
  components.set(name, instance);
  return instance;
}