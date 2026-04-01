import type { InvalidEvent } from "react";

type SupportedField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export function applyRequiredValidationMessage(
  event: InvalidEvent<SupportedField>,
  message: string
) {
  if (event.currentTarget.validity.valueMissing) {
    event.currentTarget.setCustomValidity(message);
  }
}

export function clearValidationMessage(event: { currentTarget: SupportedField }) {
  event.currentTarget.setCustomValidity("");
}
