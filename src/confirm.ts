/**
 * Creates a nonblocking confirmation prompt using an HTML dialog so browser
 * alerts cannot interrupt full screen. Closing or pressing Escape cancels.
 * @param dialog the confirmation dialog, with a question paragraph and a dialog-method form
 * @returns a function that resolves after the player chooses; overlapping requests are declined
 */
export function createConfirmDialog(dialog: HTMLDialogElement): (question: string) => Promise<boolean> {
  const questionText = dialog.querySelector<HTMLElement>('[data-question]')!;
  let answer: ((confirmed: boolean) => void) | null = null;
  dialog.addEventListener('close', () => {
    const resolve = answer;
    answer = null;
    resolve?.(dialog.returnValue === 'confirm');
  });
  return (question) => {
    if (answer) {
      return Promise.resolve(false);
    }
    questionText.textContent = question;
    dialog.returnValue = 'cancel';
    return new Promise((resolve) => {
      answer = resolve;
      dialog.showModal();
    });
  };
}
