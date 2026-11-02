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


export type IconName = "out" | "check" | "circle" | "dot" | "right";

const iconTable: Record<IconName, { size: number; strokeWidth: string; shapes: { tag: string; attrs: Record<string, string> }[] }> = {
  out: { size: 16, strokeWidth: "2", shapes: [{ tag: "path", attrs: { d: "M7 17L17 7M9 7h8v8" } }] },
  check: { size: 18, strokeWidth: "2.2", shapes: [{ tag: "path", attrs: { d: "M5 12.5l4.5 4.5L19 7.5" } }] },
  circle: { size: 18, strokeWidth: "1.7", shapes: [{ tag: "circle", attrs: { cx: "12", cy: "12", r: "7.5" } }] },
  dot: {
    size: 18,
    strokeWidth: "1.7",
    shapes: [
      { tag: "circle", attrs: { cx: "12", cy: "12", r: "7.5" } },
      { tag: "circle", attrs: { cx: "12", cy: "12", r: "3", fill: "currentColor", stroke: "none" } },
    ],
  },
  right: { size: 20, strokeWidth: "1.7", shapes: [{ tag: "path", attrs: { d: "M9 6l6 6-6 6" } }] },
};

export function createIcon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const config = iconTable[name];
  svg.setAttribute("width", String(config.size));
  svg.setAttribute("height", String(config.size));
  svg.setAttribute("stroke-width", config.strokeWidth);
  for (const shape of config.shapes) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", shape.tag);
    for (const [key, value] of Object.entries(shape.attrs)) {
      element.setAttribute(key, value);
    }
    svg.appendChild(element);
  }
  return svg;
}

export function createCopyButton(text: string, className: string): HTMLButtonElement {
  const button = make("button", className, "Copy");
  button.type = "button";
  button.setAttribute("data-copy", text);
  return button;
}

export function createCommandBox(text: string, options?: { isBig?: boolean; isPrimary?: boolean }): HTMLDivElement {
  let boxClass = "cmd";
  if (options?.isBig) boxClass += " cmd-big";
  if (text.includes("\n")) boxClass += " cmd-multi";
  const container = make("div", boxClass);
  const pre = make("pre");
  const code = make("code");
  code.textContent = text;
  pre.appendChild(code);
  container.appendChild(pre);
  const buttonClass = getButtonClass(options);
  const button = createCopyButton(text, buttonClass);
  container.appendChild(button);
  return container;
}

function getButtonClass(options?: { isBig?: boolean; isPrimary?: boolean }): string {
  if (options?.isPrimary) return "btn btn-primary ctl";
  if (options?.isBig) return "btn btn-line ctl";
  return "btn btn-line btn-sm ctl";
}

export function createFold(title: string | Node[], body: Node[], options: { key: string; className?: string; id?: string }): HTMLDetailsElement {
  const details = make("details", "fold" + (options.className ? " " + options.className : ""));
  details.setAttribute("data-key", options.key);
  if (options.id) details.id = options.id;
  const summary = make("summary");
  appendTitle(summary, title);
  details.appendChild(summary);
  const wrap = make("div", "fold-body");
  for (const node of body) wrap.appendChild(node);
  details.appendChild(wrap);
  return details;
}

function appendTitle(summary: HTMLElement, title: string | Node[]): void {
  if (typeof title === "string") {
    const span = make("span", undefined, title);
    summary.appendChild(span);
  } else {
    for (const node of title) summary.appendChild(node);
  }
}

export function createStepHeading(stepNumber: number, title: string): HTMLHeadingElement {
  const heading = make("h2", "step-title");
  if (stepNumber > 0) {
    const number = make("span", "step-n", `Step ${stepNumber}.`);
    heading.appendChild(number);
    heading.appendChild(document.createTextNode(" "));
  }
  renderRichText(title, heading);
  return heading;
}
