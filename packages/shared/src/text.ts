/**
 * Input sanitising shared by every free-text field. React escapes output, so
 * this is not about HTML injection; it removes invisible control characters,
 * normalises Unicode and trims, so "Anjali" and "Anjali​ " are the same.
 */

// C0/C1 control characters except tab/newline, plus zero-width and bidi overrides.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿]/g;

/** Multi-line text (question prompts, explanations). */
export function sanitizeMultiline(input: string): string {
  return input
    .normalize('NFC')
    .replace(CONTROL_CHARS, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Single-line text (names, options, answers): newlines collapse to spaces. */
export function sanitizeLine(input: string): string {
  return sanitizeMultiline(input).replace(/\s+/g, ' ');
}

/** Room codes avoid look-alike characters (no I, O, 0, 1). */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{5}$/;

/** Accepts " ab7-kq " and returns "AB7KQ"; returns null when it cannot be a code. */
export function normalizeRoomCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  return ROOM_CODE_PATTERN.test(code) ? code : null;
}
