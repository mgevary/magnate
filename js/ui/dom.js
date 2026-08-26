// dom.js — tiny DOM helpers. ES2018 / Safari 12 safe.

export function el(tag, attrs, children) {
  var node = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'onTap') {
        node.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          v(e);
        });
      }
      else if (k === 'style') node.setAttribute('style', v);
      else node.setAttribute(k, v);
    });
  }
  if (children) {
    children.forEach(function (c) {
      if (c === null || c === undefined) return;
      if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    });
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function qs(sel) { return document.querySelector(sel); }
