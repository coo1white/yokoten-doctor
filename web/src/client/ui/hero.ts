import { toSentence } from '../view.ts';
import { rerunHref } from '../fixes.ts';
import type { CheckResult, ViewModel, ResultPlan, FixesPayload } from '../types.ts';
import { createIcon, make, renderRichText } from './dom.ts';
import { renderAllChecks } from './checks.ts';

export function renderSummary({ lastResult, vm, plan, lastFixes, isEntering }: { lastResult: CheckResult; vm: ViewModel; plan: ResultPlan; lastFixes: FixesPayload | null; isEntering: boolean }): HTMLElement {
  const ownerName = String((lastResult as unknown as { owner?: unknown }).owner ?? '');
  const repositoryName = String((lastResult as unknown as { repo?: unknown }).repo ?? '');
  const doneCount = (plan as unknown as { done?: number }).done ?? 0;
  const totalCount = (plan as unknown as { total?: number }).total ?? 0;
  const segmentList = (plan as unknown as { segments?: string[] }).segments ?? [];
  const legendList = (plan as unknown as { legend?: Array<{ swatch: string; text: string } | [string, string]> }).legend ?? [];
  const scoreText = (vm as unknown as { score?: { text?: string } }).score?.text ?? '';
  const outerSection = make('section', 'zone-sum');
  const innerContainer = make('div', 'sum-in');
  outerSection.appendChild(innerContainer);
  const stateContainer = document.createElement('div');
  if (isEntering) stateContainer.className = 'enter';
  const headerContainer = make('div', 'r-head');
  const titleHeading = make('h1', 'r-repo');
  const repositoryLink = document.createElement('a');
  repositoryLink.href = 'https://github.com/' + encodeURIComponent(ownerName) + '/' + encodeURIComponent(repositoryName);
  repositoryLink.appendChild(document.createTextNode(ownerName));
  repositoryLink.appendChild(document.createTextNode('/'));
  repositoryLink.appendChild(document.createElement('wbr'));
  repositoryLink.appendChild(document.createTextNode(repositoryName));
  titleHeading.appendChild(repositoryLink);
  headerContainer.appendChild(titleHeading);
  const toolsContainer = make('div', 'r-tools');
  const savedElement = document.getElementById('saved-check') as HTMLElement | null;
  const savedValue = savedElement?.dataset.saved;
  if (savedValue) {
    const savedSpan = make('span', undefined, `Saved ${savedValue}`);
    toolsContainer.appendChild(savedSpan);
    const rerunLink = document.createElement('a');
    rerunLink.className = 'link ctl';
    rerunLink.href = rerunHref(ownerName, repositoryName);
    rerunLink.textContent = 'Run it again';
    toolsContainer.appendChild(rerunLink);
  }
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'link ctl';
  copyButton.textContent = 'Copy link';
  copyButton.setAttribute('data-copy-url', '');
  toolsContainer.appendChild(copyButton);
  headerContainer.appendChild(toolsContainer);
  stateContainer.appendChild(headerContainer);
  const summaryValue = (lastFixes as unknown as { summary?: unknown } | null)?.summary;
  const summaryText = typeof summaryValue === 'string' ? summaryValue : '';
  const hasSummary = summaryText.trim() !== '';
  if (hasSummary) {
    const aboutParagraph = make('p', 'r-about');
    aboutParagraph.appendChild(document.createTextNode(summaryText.trim()));
    aboutParagraph.appendChild(document.createTextNode(' '));
    const museSpan = make('span', undefined, 'Summary by Muse.');
    aboutParagraph.appendChild(museSpan);
    stateContainer.appendChild(aboutParagraph);
  }
  const countParagraph = make('p', 'count');
  const boldElement = make('b', undefined, String(doneCount));
  countParagraph.appendChild(boldElement);
  const countSpan = make('span', undefined, `of ${totalCount} file checks pass`);
  countParagraph.appendChild(countSpan);
  stateContainer.appendChild(countParagraph);
  const barContainer = make('div', isEntering ? 'bar bar-anim' : 'bar');
  barContainer.setAttribute('role', 'img');
  barContainer.setAttribute('aria-label', scoreText);
  for (const segment of segmentList) {
    const segmentElement = document.createElement('i');
    if (segment) segmentElement.className = segment;
    barContainer.appendChild(segmentElement);
  }
  stateContainer.appendChild(barContainer);
  if (legendList.length > 0) {
    const legendElement = make('ul', 'legend');
    for (const entry of legendList) {
      const listItem = document.createElement('li');
      let swatchName = '';
      let entryText = '';
      if (Array.isArray(entry)) {
        swatchName = entry[0] ?? '';
        entryText = entry[1] ?? '';
      } else {
        const record = entry as { swatch?: unknown; text?: unknown };
        swatchName = typeof record.swatch === 'string' ? record.swatch : '';
        entryText = typeof record.text === 'string' ? record.text : '';
      }
      const swatchSpan = make('span', `swatch ${swatchName}`);
      swatchSpan.setAttribute('aria-hidden', 'true');
      listItem.appendChild(swatchSpan);
      listItem.appendChild(document.createTextNode(entryText));
      legendElement.appendChild(listItem);
    }
    stateContainer.appendChild(legendElement);
  }
  const noteParagraph = make('p', 'count-note', 'These checks read files. They don\'t judge your code.');
  stateContainer.appendChild(noteParagraph);
  innerContainer.appendChild(stateContainer);
  const nextRecord = (vm as unknown as { next?: { id?: string; title?: string; why?: string } | null }).next ?? null;
  if (!nextRecord) {
    const nextSection = make('section', 'next');
    const labelParagraph = make('p', 'next-label', 'Nothing to fix');
    nextSection.appendChild(labelParagraph);
    const headingElement = make('h2', undefined, `All ${totalCount} file checks pass.`);
    nextSection.appendChild(headingElement);
    innerContainer.appendChild(nextSection);
  } else {
    const nextSection = document.createElement('section');
    nextSection.className = 'next';
    nextSection.setAttribute('aria-labelledby', 'next-title');
    const labelParagraph = make('p', 'next-label', 'Do this first');
    nextSection.appendChild(labelParagraph);
    const titleHeadingElement = document.createElement('h2');
    titleHeadingElement.id = 'next-title';
    const titleText = typeof nextRecord.title === 'string' ? nextRecord.title : '';
    renderRichText(titleText, titleHeadingElement);
    nextSection.appendChild(titleHeadingElement);
    let whyText = '';
    if (nextRecord.id === 'issues') whyText = 'Turn on issues in the repo\'s settings on GitHub.';
    else {
      const rawWhy = typeof nextRecord.why === 'string' ? nextRecord.why : '';
      if (rawWhy) whyText = toSentence(rawWhy);
    }
    if (whyText !== '') {
      const whyParagraph = make('p', 'next-why');
      renderRichText(whyText, whyParagraph);
      nextSection.appendChild(whyParagraph);
    }
    const actionRecord = (plan as unknown as { action?: { href?: string; label?: string; isQuiet?: boolean; opensChart?: boolean } }).action;
    if (actionRecord && typeof actionRecord.href === 'string' && typeof actionRecord.label === 'string') {
      const actionHref = actionRecord.href;
      const actionLabel = actionRecord.label;
      const isQuiet = Boolean(actionRecord.isQuiet);
      const opensChart = Boolean(actionRecord.opensChart);
      const actionLink = document.createElement('a');
      actionLink.href = actionHref;
      actionLink.className = isQuiet ? 'btn btn-line ctl' : 'btn btn-primary ctl';
      actionLink.textContent = actionLabel;
      if (actionHref.startsWith('https://')) {
        actionLink.target = '_blank';
        actionLink.rel = 'noopener';
        const outIcon = createIcon('out');
        actionLink.appendChild(outIcon);
      }
      if (opensChart) {
        actionLink.addEventListener('click', (): void => {
          const allDetails = document.querySelector('details[data-key=\"all-checks\"]') as HTMLDetailsElement | null;
          if (allDetails) allDetails.open = true;
          if (actionHref.startsWith('#')) {
            const identifier = actionHref.slice(1);
            const targetElement = document.getElementById(identifier);
            if (targetElement && targetElement.tagName.toLowerCase() === 'details') (targetElement as HTMLDetailsElement).open = true;
          }
        });
      }
      nextSection.appendChild(actionLink);
    }
    innerContainer.appendChild(nextSection);
  }
  const allContainer = make('div', 'sum-all');
  const checksElement = renderAllChecks(lastResult, vm, plan);
  allContainer.appendChild(checksElement);
  innerContainer.appendChild(allContainer);
  return outerSection;
}
