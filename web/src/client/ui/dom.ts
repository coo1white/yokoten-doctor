import { splitCode } from "../view.ts";

export function safeUrl(href: string): string | null {
  if (typeof href !== "string") return null;
  if (href.startsWith("https://github.com/")) return href;
  if (href.startsWith("https://yokoten.app/")) return href;
  if (href.startsWith("https://")) return href;
  return null;
}

export function createLink(href: string, text: string): HTMLElement {
  const a = document.createElement("a");
  const safe = safeUrl(href);
  if (safe) {
    a.href = safe;
    a.textContent = text;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  } else {
    const span = document.createElement("span");
    span.textContent = text + " (" + href + ")";
    return span;
  }
  return a;
}

export function captureDetailsState(root: Element | null, openSet: Set<string>): void {
  if (!root) return;
  const detailsEls = root.querySelectorAll("details[data-key]");
  for (const d of detailsEls) {
    const key = d.getAttribute("data-key");
    if (!key) continue;
    if ((d as HTMLDetailsElement).open) openSet.add(key);
    else openSet.delete(key);
  }
}

export function restoreDetailsState(root: Element | null, openSet: Set<string>): void {
  if (!root) return;
  const detailsEls = root.querySelectorAll("details[data-key]");
  for (const d of detailsEls) {
    const key = d.getAttribute("data-key");
    if (!key) continue;
    if (openSet.has(key)) (d as HTMLDetailsElement).open = true;
  }
}

export function renderRichText(text: string | null | undefined, parent: HTMLElement): void {
  if (text == null || text === "") return;
  const parts = splitCode(text);
  for (const p of parts) {
    if (p.isCode) {
      const c = document.createElement("code");
      c.textContent = p.text;
      parent.appendChild(c);
    } else {
      parent.appendChild(document.createTextNode(p.text));
    }
  }
}

export function make<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
export function createRich<K extends keyof HTMLElementTagNameMap>(tag: K, className: string | undefined, text: string): HTMLElementTagNameMap[K] {
  const element = make(tag, className);
  renderRichText(text, element);
  return element;
}
export type IconName = 'out' | 'check' | 'circle' | 'dot' | 'right';
export function createIcon(name: IconName): SVGSVGElement {
  const svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgElement.setAttribute('viewBox', '0 0 24 24');
  svgElement.setAttribute('fill', 'none');
  svgElement.setAttribute('stroke', 'currentColor');
  svgElement.setAttribute('stroke-linecap', 'round');
  svgElement.setAttribute('stroke-linejoin', 'round');
  svgElement.setAttribute('aria-hidden', 'true');
  let sizeValue = 18;
  let strokeWidthValue = '1.7';
  if (name === 'right') {
    sizeValue = 20;
    strokeWidthValue = '1.7';
  } else if (name === 'out') {
    sizeValue = 16;
    strokeWidthValue = '2';
  } else if (name === 'check') {
    sizeValue = 18;
    strokeWidthValue = '2.2';
  } else if (name === 'circle') {
    sizeValue = 18;
    strokeWidthValue = '1.7';
  } else if (name === 'dot') {
    sizeValue = 18;
    strokeWidthValue = '1.7';
  }
  svgElement.setAttribute('width', String(sizeValue));
  svgElement.setAttribute('height', String(sizeValue));
  svgElement.setAttribute('stroke-width', strokeWidthValue);
  if (name === 'right') {
    const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathElement.setAttribute('d', 'M9 6l6 6-6 6');
    svgElement.appendChild(pathElement);
  } else if (name === 'out') {
    const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathElement.setAttribute('d', 'M7 17L17 7M9 7h8v8');
    svgElement.appendChild(pathElement);
  } else if (name === 'check') {
    const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathElement.setAttribute('d', 'M5 12.5l4.5 4.5L19 7.5');
    svgElement.appendChild(pathElement);
  } else if (name === 'circle') {
    const circleElement = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circleElement.setAttribute('cx', '12');
    circleElement.setAttribute('cy', '12');
    circleElement.setAttribute('r', '7.5');
    svgElement.appendChild(circleElement);
  } else if (name === 'dot') {
    const outerCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    outerCircle.setAttribute('cx', '12');
    outerCircle.setAttribute('cy', '12');
    outerCircle.setAttribute('r', '7.5');
    svgElement.appendChild(outerCircle);
    const innerCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    innerCircle.setAttribute('cx', '12');
    innerCircle.setAttribute('cy', '12');
    innerCircle.setAttribute('r', '3');
    innerCircle.setAttribute('fill', 'currentColor');
    innerCircle.setAttribute('stroke', 'none');
    svgElement.appendChild(innerCircle);
  }
  return svgElement;
}
export function createCopyButton(text: string, className: string): HTMLButtonElement {
  const buttonElement = document.createElement('button');
  buttonElement.type = 'button';
  buttonElement.className = className;
  buttonElement.textContent = 'Copy';
  buttonElement.setAttribute('data-copy', text);
  return buttonElement;
}
export function createCommandBox(text: string, options?: { isBig?: boolean; isPrimary?: boolean }): HTMLDivElement {
  let boxClass = 'cmd';
  if (options?.isBig) boxClass += ' cmd-big';
  if (text.includes('\n')) boxClass += ' cmd-multi';
  const container = make('div', boxClass);
  const preElement = make('pre');
  const codeElement = make('code');
  codeElement.textContent = text;
  preElement.appendChild(codeElement);
  container.appendChild(preElement);
  let buttonClass = 'btn btn-line btn-sm ctl';
  if (options?.isPrimary) buttonClass = 'btn btn-primary ctl';
  else if (options?.isBig) buttonClass = 'btn btn-line ctl';
  const copyButton = createCopyButton(text, buttonClass);
  container.appendChild(copyButton);
  return container;
}
export function createFold(title: string | Node[], body: Node[], options: { key: string; className?: string; id?: string }): HTMLDetailsElement {
  const detailsElement = document.createElement('details');
  detailsElement.className = 'fold' + (options.className ? ' ' + options.className : '');
  detailsElement.setAttribute('data-key', options.key);
  if (options.id) detailsElement.id = options.id;
  const summaryElement = document.createElement('summary');
  if (typeof title === 'string') {
    const titleSpan = make('span', undefined, title);
    summaryElement.appendChild(titleSpan);
  } else {
    for (const node of title) summaryElement.appendChild(node);
  }
  detailsElement.appendChild(summaryElement);
  const bodyContainer = make('div', 'fold-body');
  for (const node of body) bodyContainer.appendChild(node);
  detailsElement.appendChild(bodyContainer);
  return detailsElement;
}
export function createStepHeading(stepNumber: number, title: string): HTMLHeadingElement {
  const headingElement = make('h2', 'step-title');
  if (stepNumber > 0) {
    const numberSpan = make('span', 'step-n', `Step ${stepNumber}.`);
    headingElement.appendChild(numberSpan);
    headingElement.appendChild(document.createTextNode(' '));
  }
  renderRichText(title, headingElement);
  return headingElement;
}
