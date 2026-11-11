/** @param {string} text */
export const toTxt = (text) => (text.endsWith("\n") ? text : `${text}\n`);
