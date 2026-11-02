import { make } from './ui/dom.ts';
export interface StepNavItem { id: string; stepNumber: number; title: string; }
export function renderStepNav(items: StepNavItem[]): { rail: HTMLElement; bar: HTMLElement } {
  const numberedList = items.filter((item: StepNavItem): boolean => item.stepNumber !== 0);
  const totalNumbered = numberedList.length;
  const firstItem = items[0];
  const firstCountText = firstItem && firstItem.stepNumber ? `Step ${firstItem.stepNumber} of ${totalNumbered}` : '';
  const firstTitleText = firstItem ? firstItem.title : '';
  const nextTitleText = items[1] ? `Next: ${items[1].title}` : '';
  const createListItem = (item: StepNavItem, isFirst: boolean): HTMLLIElement => {
    const listItem = document.createElement('li');
    if (!item.stepNumber) listItem.className = 'rail-extra';
    const linkElement = document.createElement('a');
    linkElement.className = 'rail-link';
    linkElement.href = '#' + item.id;
    linkElement.setAttribute('data-step-link', item.id);
    if (isFirst) linkElement.setAttribute('aria-current', 'step');
    if (item.stepNumber) {
      const numberSpan = make('span', 'rail-no', String(item.stepNumber));
      linkElement.appendChild(numberSpan);
    }
    const titleSpan = make('span');
    titleSpan.textContent = item.title;
    linkElement.appendChild(titleSpan);
    listItem.appendChild(linkElement);
    return listItem;
  };
  const railNavigation = document.createElement('nav');
  railNavigation.className = 'rail';
  railNavigation.setAttribute('aria-label', 'Steps');
  railNavigation.setAttribute('data-total', String(totalNumbered));
  const railCountParagraph = make('p', 'rail-count');
  railCountParagraph.setAttribute('data-step-count', '');
  railCountParagraph.textContent = firstCountText;
  railNavigation.appendChild(railCountParagraph);
  const railList = document.createElement('ol');
  for (let index = 0; index < items.length; index++) {
    const currentItem = items[index] as StepNavItem;
    railList.appendChild(createListItem(currentItem, index === 0));
  }
  railNavigation.appendChild(railList);
  const barNavigation = document.createElement('nav');
  barNavigation.className = 'stepbar';
  barNavigation.setAttribute('aria-label', 'Steps');
  const detailsElement = document.createElement('details');
  detailsElement.setAttribute('data-stepbar', '');
  const summaryElement = document.createElement('summary');
  const nowContainer = make('span', 'stepbar-now');
  const countBold = make('b');
  countBold.setAttribute('data-step-count', '');
  countBold.textContent = firstCountText;
  nowContainer.appendChild(countBold);
  nowContainer.appendChild(document.createTextNode(' '));
  const titleSpanElement = make('span');
  titleSpanElement.setAttribute('data-step-title', '');
  titleSpanElement.textContent = firstTitleText;
  nowContainer.appendChild(titleSpanElement);
  summaryElement.appendChild(nowContainer);
  const nextSpanElement = make('span', 'stepbar-next');
  nextSpanElement.setAttribute('data-step-next', '');
  nextSpanElement.textContent = nextTitleText;
  summaryElement.appendChild(nextSpanElement);
  detailsElement.appendChild(summaryElement);
  const barList = document.createElement('ol');
  barList.className = 'stepbar-list';
  for (let index = 0; index < items.length; index++) {
    const currentItem = items[index] as StepNavItem;
    barList.appendChild(createListItem(currentItem, index === 0));
  }
  detailsElement.appendChild(barList);
  barNavigation.appendChild(detailsElement);
  return { rail: railNavigation, bar: barNavigation };
}
export function startStepSpy(root: HTMLElement): () => void {
  const stepElements = Array.from(root.querySelectorAll<HTMLElement>('[data-steps] .step[id]'));
  if (stepElements.length === 0) return (): void => {};
  const linkElements = Array.from(root.querySelectorAll<HTMLElement>('[data-step-link]'));
  const countElements = Array.from(root.querySelectorAll<HTMLElement>('[data-step-count]'));
  const titleElement = root.querySelector<HTMLElement>('[data-step-title]');
  const nextElement = root.querySelector<HTMLElement>('[data-step-next]');
  const barElement = root.querySelector<HTMLDetailsElement>('[data-stepbar]');
  const railElement = root.querySelector<HTMLElement>('.rail');
  const totalValue = railElement?.getAttribute('data-total') ?? '';
  const titleList = stepElements.map((stepElement: HTMLElement): string => {
    const linkElement = root.querySelector(`.rail [data-step-link=\"${stepElement.id}\"]`);
    const spanElement = linkElement?.querySelector('span:last-child');
    return spanElement?.textContent ?? '';
  });
  let shownIndex = -1;
  const paintIndex = (index: number): void => {
    if (index === shownIndex) return;
    shownIndex = index;
    const targetElement = stepElements[index];
    if (!targetElement) return;
    stepElements.forEach((element: HTMLElement, position: number): void => {
      element.classList.toggle('is-current', position === index);
    });
    const targetIdentifier = targetElement.id;
    linkElements.forEach((linkElement: HTMLElement): void => {
      const linkIdentifier = linkElement.getAttribute('data-step-link');
      if (linkIdentifier === targetIdentifier) linkElement.setAttribute('aria-current', 'step');
      else linkElement.removeAttribute('aria-current');
    });
    const numberValue = targetElement.getAttribute('data-no');
    countElements.forEach((countElement: HTMLElement): void => {
      countElement.textContent = numberValue ? `Step ${numberValue} of ${totalValue}` : '';
    });
    if (titleElement) titleElement.textContent = titleList[index] ?? '';
    if (nextElement) {
      const upcomingTitle = titleList[index + 1];
      nextElement.textContent = upcomingTitle ? `Next: ${upcomingTitle}` : '';
    }
  };
  const currentHash = typeof location !== 'undefined' ? location.hash : '';
  let pinnedIndex = stepElements.findIndex((element: HTMLElement): boolean => '#' + element.id === currentHash);
  const controller = new AbortController();
  const signal = controller.signal;
  const eventTypes = ['wheel', 'touchmove', 'keydown'];
  eventTypes.forEach((eventType: string): void => {
    window.addEventListener(eventType, (event: Event): void => {
      if (eventType !== 'keydown' || (event as KeyboardEvent).key !== 'Enter') pinnedIndex = -1;
    }, { passive: true, signal });
  });
  let queuedFlag = false;
  const spyFunction = (): void => {
    queuedFlag = false;
    if (pinnedIndex >= 0) {
      paintIndex(pinnedIndex);
      return;
    }
    const linePosition = window.innerHeight * 0.35;
    let currentIndex = 0;
    stepElements.forEach((element: HTMLElement, position: number): void => {
      if (element.getBoundingClientRect().top <= linePosition) currentIndex = position;
    });
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) currentIndex = stepElements.length - 1;
    paintIndex(currentIndex);
  };
  window.addEventListener('scroll', (): void => {
    if (!queuedFlag) {
      queuedFlag = true;
      requestAnimationFrame(spyFunction);
    }
  }, { passive: true, signal });
  window.addEventListener('resize', spyFunction, { signal });
  document.addEventListener('toggle', spyFunction, { capture: true, signal });
  linkElements.forEach((linkElement: HTMLElement): void => {
    linkElement.addEventListener('click', (): void => {
      if (barElement) barElement.open = false;
      const linkIdentifier = linkElement.getAttribute('data-step-link');
      pinnedIndex = stepElements.findIndex((element: HTMLElement): boolean => element.id === linkIdentifier);
      spyFunction();
    }, { signal });
  });
  spyFunction();
  return (): void => controller.abort();
}
