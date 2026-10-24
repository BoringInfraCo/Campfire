/**
 * HTTP client for the hosted publication boundary.
 *
 * These routes are separate from actor dispatch: enrollment creates a fresh
 * owner credential for an empty private namespace, and import accepts only the
 * newly minted owner token. Invitation secrets and install tokens cannot call
 * either route.
 */
import {
  PUBLICATION_REHEARSAL_HEADER,
  type PublicationEnrollmentInput,
  type PublicationEnrollmentReceipt,
  type PublicationImportInput,
  type PublicationImportReceipt,
  type PublicationRecoveryInput,
  type PublicationRecoveryReceipt,
} from "../domain/publication.js";
import { readCampfireResponse } from "../http/client.js";

function route(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function admissionHeaders(rehearsalCode: string | undefined): Record<string, string> {
  return rehearsalCode === undefined ? {} : { [PUBLICATION_REHEARSAL_HEADER]: rehearsalCode };
}

export async function enrollPublication(input: {
  endpoint: string;
  body: PublicationEnrollmentInput;
  rehearsalCode?: string;
  timeoutMs?: number;
}): Promise<PublicationEnrollmentReceipt> {
  const response = await fetch(route(input.endpoint, "/v1/publication/enroll"), {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(input.timeoutMs ?? 20_000),
    headers: { "content-type": "application/json", ...admissionHeaders(input.rehearsalCode) },
    body: JSON.stringify(input.body),
  });
  return readCampfireResponse<PublicationEnrollmentReceipt>(response);
}

export async function importPublication(input: {
  endpoint: string;
  token: string;
  body: PublicationImportInput;
  rehearsalCode?: string;
  timeoutMs?: number;
}): Promise<PublicationImportReceipt> {
  const response = await fetch(route(input.endpoint, "/v1/publication/import"), {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(input.timeoutMs ?? 30_000),
    headers: {
      authorization: `Bearer ${input.token}`,
      "content-type": "application/json",
      ...admissionHeaders(input.rehearsalCode),
    },
    body: JSON.stringify(input.body),
  });
  return readCampfireResponse<PublicationImportReceipt>(response);
}

export async function recoverPublication(input: {
  endpoint: string;
  body: PublicationRecoveryInput;
  rehearsalCode?: string;
}): Promise<PublicationRecoveryReceipt> {
  const response = await fetch(route(input.endpoint, "/v1/publication/recover"), {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: { "content-type": "application/json", ...admissionHeaders(input.rehearsalCode) },
    body: JSON.stringify(input.body),
  });
  return readCampfireResponse<PublicationRecoveryReceipt>(response);
}
