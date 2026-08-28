// Server-only connector implementations: Gmail + Google Slides via the Lovable
// connector gateway, FHIR and Reddit as custom REST integrations.

const GATEWAY = "https://connector-gateway.lovable.dev";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing project secret: ${name}`);
  return value;
}

export function connectorConfigured(id: string): boolean {
  switch (id) {
    case "gmail":
      return Boolean(process.env["GOOGLE_MAIL_API_KEY"] && process.env["LOVABLE_API_KEY"]);
    case "google_slides":
      return Boolean(process.env["GOOGLE_SLIDES_API_KEY"] && process.env["LOVABLE_API_KEY"]);
    case "fhir":
      return Boolean(process.env["FHIR_BASE_URL"] && process.env["FHIR_BEARER_TOKEN"]);
    case "reddit":
      return Boolean(process.env["REDDIT_CLIENT_ID"] && process.env["REDDIT_CLIENT_SECRET"]);
    case "firecrawl":
      return Boolean(process.env["FIRECRAWL_API_KEY"]);
    default:
      return false;
  }
}

async function gatewayFetch(
  connector: "google_mail" | "google_slides",
  path: string,
  init?: RequestInit,
) {
  const keyName = connector === "google_mail" ? "GOOGLE_MAIL_API_KEY" : "GOOGLE_SLIDES_API_KEY";
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${requireEnv("LOVABLE_API_KEY")}`);
  headers.set("X-Connection-Api-Key", requireEnv(keyName));
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(`${GATEWAY}/${connector}${path}`, { ...init, headers });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${connector} error ${response.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : {};
}

/* ------------------------------- Gmail ---------------------------------- */

const GMAIL = "/gmail/v1";

function b64(input: string) {
  return btoa(Array.from(new TextEncoder().encode(input), (b) => String.fromCharCode(b)).join(""));
}
function mimeHeader(value: string) {
  return /^[\x00-\x7F]*$/.test(value) ? value : `=?UTF-8?B?${b64(value)}?=`;
}

type GmailHeader = { name?: string; value?: string };

function headerValue(headers: GmailHeader[] | undefined, name: string) {
  return headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

export async function gmailSearch(query: string, limit = 10) {
  const list = (await gatewayFetch(
    "google_mail",
    `${GMAIL}/users/me/messages?maxResults=${Math.min(limit, 25)}&q=${encodeURIComponent(query)}`,
  )) as { messages?: { id: string }[] };

  const ids = (list.messages ?? []).map((m) => m.id);
  const messages = [];
  for (const id of ids) {
    const message = (await gatewayFetch(
      "google_mail",
      `${GMAIL}/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
    )) as { id: string; snippet?: string; payload?: { headers?: GmailHeader[] } };
    messages.push({
      id: message.id,
      from: headerValue(message.payload?.headers, "From"),
      subject: headerValue(message.payload?.headers, "Subject"),
      date: headerValue(message.payload?.headers, "Date"),
      snippet: message.snippet ?? "",
    });
  }
  return { count: messages.length, messages };
}

function decodeBody(payload: unknown, depth = 0): string {
  if (!payload || typeof payload !== "object" || depth > 4) return "";
  const node = payload as {
    mimeType?: string;
    body?: { data?: string };
    parts?: unknown[];
  };
  if (node.body?.data) {
    try {
      const normalized = node.body.data.replace(/-/g, "+").replace(/_/g, "/");
      const bytes = Uint8Array.from(atob(normalized), (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return "";
    }
  }
  for (const part of node.parts ?? []) {
    const text = decodeBody(part, depth + 1);
    if (text) return text;
  }
  return "";
}

export async function gmailReadMessage(messageId: string) {
  const message = (await gatewayFetch(
    "google_mail",
    `${GMAIL}/users/me/messages/${messageId}?format=full`,
  )) as { id: string; payload?: { headers?: GmailHeader[] } };
  return {
    id: message.id,
    from: headerValue(message.payload?.headers, "From"),
    to: headerValue(message.payload?.headers, "To"),
    subject: headerValue(message.payload?.headers, "Subject"),
    date: headerValue(message.payload?.headers, "Date"),
    body: decodeBody(message.payload).slice(0, 6000),
  };
}

export async function gmailSend(to: string, subject: string, body: string) {
  const raw = b64(
    [
      `To: ${to}`,
      `Subject: ${mimeHeader(subject)}`,
      "MIME-Version: 1.0",
      'Content-Type: text/plain; charset="UTF-8"',
      "",
      body,
    ].join("\r\n"),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const sent = (await gatewayFetch("google_mail", `${GMAIL}/users/me/messages/send`, {
    method: "POST",
    body: JSON.stringify({ raw }),
  })) as { id?: string };
  return { sent: true, id: sent.id ?? null, to, subject };
}

/* ---------------------------- Google Slides ----------------------------- */

const SLIDES = "/v1";

export async function slidesCreate(title: string) {
  const deck = (await gatewayFetch("google_slides", `${SLIDES}/presentations`, {
    method: "POST",
    body: JSON.stringify({ title }),
  })) as { presentationId?: string; slides?: { objectId?: string }[] };
  return {
    presentationId: deck.presentationId ?? null,
    url: deck.presentationId
      ? `https://docs.google.com/presentation/d/${deck.presentationId}/edit`
      : null,
    firstSlideId: deck.slides?.[0]?.objectId ?? null,
  };
}

export async function slidesRead(presentationId: string) {
  const deck = (await gatewayFetch(
    "google_slides",
    `${SLIDES}/presentations/${presentationId}`,
  )) as {
    title?: string;
    slides?: { objectId?: string; pageElements?: unknown[] }[];
  };

  const slides = (deck.slides ?? []).map((slide, index) => {
    const texts: string[] = [];
    for (const element of (slide.pageElements ?? []) as {
      shape?: { text?: { textElements?: { textRun?: { content?: string } }[] } };
    }[]) {
      for (const te of element.shape?.text?.textElements ?? []) {
        if (te.textRun?.content) texts.push(te.textRun.content.trim());
      }
    }
    return { index, objectId: slide.objectId ?? null, text: texts.filter(Boolean).join(" | ") };
  });

  return { title: deck.title ?? "", slideCount: slides.length, slides };
}

export async function slidesAddSlide(presentationId: string, title: string, body: string) {
  const slideId = `s${Date.now().toString(36)}`;
  await gatewayFetch("google_slides", `${SLIDES}/presentations/${presentationId}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          createSlide: {
            objectId: slideId,
            slideLayoutReference: { predefinedLayout: "TITLE_AND_BODY" },
            placeholderIdMappings: [
              { layoutPlaceholder: { type: "TITLE", index: 0 }, objectId: `${slideId}_t` },
              { layoutPlaceholder: { type: "BODY", index: 0 }, objectId: `${slideId}_b` },
            ],
          },
        },
        { insertText: { objectId: `${slideId}_t`, text: title } },
        { insertText: { objectId: `${slideId}_b`, text: body } },
      ],
    }),
  });
  return { added: true, slideId };
}

/* -------------------------------- FHIR ---------------------------------- */

async function fhirGet(path: string, params: Record<string, string | number | undefined> = {}) {
  const base = requireEnv("FHIR_BASE_URL").replace(/\/$/, "");
  const url = new URL(`${base}/${path.replace(/^\//, "")}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${requireEnv("FHIR_BEARER_TOKEN")}`,
      Accept: "application/fhir+json",
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`FHIR error ${response.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

type FhirEntry = { resource?: Record<string, unknown> };

function bundleResources(bundle: unknown): Record<string, unknown>[] {
  const entries = (bundle as { entry?: FhirEntry[] })?.entry ?? [];
  return entries.map((e) => e.resource ?? {}).filter((r) => Object.keys(r).length > 0);
}

function humanName(resource: Record<string, unknown>): string {
  const names = resource["name"] as { given?: string[]; family?: string; text?: string }[] | undefined;
  const first = names?.[0];
  if (!first) return "(unnamed)";
  return first.text ?? [first.given?.join(" "), first.family].filter(Boolean).join(" ");
}

function summarizePatient(resource: Record<string, unknown>) {
  return {
    id: resource["id"] as string | undefined,
    name: humanName(resource),
    gender: resource["gender"] as string | undefined,
    birthDate: resource["birthDate"] as string | undefined,
  };
}

export async function fhirSearchPatient(input: {
  name?: string | undefined;
  identifier?: string | undefined;
  limit?: number | undefined;
}) {

  const bundle = await fhirGet("Patient", {
    name: input.name,
    identifier: input.identifier,
    _count: input.limit ?? 10,
  });
  const patients = bundleResources(bundle).map(summarizePatient);
  return { count: patients.length, patients };
}

export async function fhirGetPatient(patientId: string) {
  const resource = (await fhirGet(`Patient/${patientId}`)) as Record<string, unknown>;
  const telecom = (resource["telecom"] as { system?: string; value?: string }[] | undefined) ?? [];
  return {
    ...summarizePatient(resource),
    contact: telecom.map((t) => `${t.system ?? "contact"}: ${t.value ?? ""}`),
  };
}

export async function fhirGetAppointments(patientId: string, limit = 10) {
  const bundle = await fhirGet("Appointment", { patient: patientId, _count: limit });
  const appointments = bundleResources(bundle).map((r) => ({
    id: r["id"] as string | undefined,
    status: r["status"] as string | undefined,
    start: r["start"] as string | undefined,
    end: r["end"] as string | undefined,
    description: (r["description"] as string | undefined) ?? "",
  }));
  return { count: appointments.length, appointments };
}

export async function fhirGetMedications(patientId: string, limit = 20) {
  const bundle = await fhirGet("MedicationRequest", { patient: patientId, _count: limit });
  const medications = bundleResources(bundle).map((r) => ({
    id: r["id"] as string | undefined,
    status: r["status"] as string | undefined,
    medication:
      (r["medicationCodeableConcept"] as { text?: string } | undefined)?.text ??
      (r["medicationReference"] as { display?: string } | undefined)?.display ??
      "unknown",
    authoredOn: r["authoredOn"] as string | undefined,
  }));
  return { count: medications.length, medications };
}

export async function fhirGetObservations(patientId: string, code?: string, limit = 20) {
  const bundle = await fhirGet("Observation", { patient: patientId, code, _count: limit });
  const observations = bundleResources(bundle).map((r) => {
    const quantity = r["valueQuantity"] as { value?: number; unit?: string } | undefined;
    return {
      id: r["id"] as string | undefined,
      code: (r["code"] as { text?: string } | undefined)?.text ?? "",
      value: quantity
        ? `${quantity.value ?? ""} ${quantity.unit ?? ""}`.trim()
        : ((r["valueString"] as string | undefined) ?? ""),
      effective: r["effectiveDateTime"] as string | undefined,
    };
  });
  return { count: observations.length, observations };
}

/* ------------------------------- Reddit --------------------------------- */

let redditToken: { value: string; expiresAt: number } | undefined;

async function redditAccessToken(): Promise<string> {
  if (redditToken && redditToken.expiresAt > Date.now() + 30_000) return redditToken.value;

  const basic = b64(`${requireEnv("REDDIT_CLIENT_ID")}:${requireEnv("REDDIT_CLIENT_SECRET")}`);
  const response = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "lovable-ai-hub/1.0",
    },
    body: "grant_type=client_credentials",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Reddit auth error ${response.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text) as { access_token: string; expires_in?: number };
  redditToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return redditToken.value;
}

async function redditGet(path: string, params: Record<string, string | number | undefined> = {}) {
  const url = new URL(`https://oauth.reddit.com${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${await redditAccessToken()}`,
      "User-Agent": "lovable-ai-hub/1.0",
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Reddit error ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

type RedditListing = {
  data?: { children?: { data?: Record<string, unknown> }[] };
};

function summarizePosts(listing: unknown) {
  const children = (listing as RedditListing)?.data?.children ?? [];
  return children
    .map((c) => c.data ?? {})
    .map((p) => ({
      id: p["id"] as string | undefined,
      title: p["title"] as string | undefined,
      subreddit: p["subreddit"] as string | undefined,
      author: p["author"] as string | undefined,
      score: p["score"] as number | undefined,
      numComments: p["num_comments"] as number | undefined,
      url: `https://reddit.com${(p["permalink"] as string | undefined) ?? ""}`,
      excerpt: ((p["selftext"] as string | undefined) ?? "").slice(0, 400),
    }));
}

export async function redditSearchSubreddit(query: string, subreddit?: string, limit = 10) {
  const path = subreddit ? `/r/${subreddit}/search` : "/search";
  const listing = await redditGet(path, {
    q: query,
    limit: Math.min(limit, 25),
    restrict_sr: subreddit ? "true" : undefined,
    sort: "relevance",
  });
  const posts = summarizePosts(listing);
  return { count: posts.length, posts };
}

export async function redditGetTopPosts(subreddit: string, timeframe = "week", limit = 10) {
  const listing = await redditGet(`/r/${subreddit}/top`, {
    t: timeframe,
    limit: Math.min(limit, 25),
  });
  const posts = summarizePosts(listing);
  return { count: posts.length, posts };
}

export async function redditGetPostComments(postId: string, limit = 20) {
  const id = postId.replace(/^t3_/, "");
  const result = (await redditGet(`/comments/${id}`, { limit: Math.min(limit, 50) })) as unknown[];
  const commentListing = result[1];
  const children = (commentListing as RedditListing)?.data?.children ?? [];
  const comments = children
    .map((c) => c.data ?? {})
    .filter((c) => c["body"])
    .map((c) => ({
      author: c["author"] as string | undefined,
      score: c["score"] as number | undefined,
      body: ((c["body"] as string | undefined) ?? "").slice(0, 600),
    }));
  return { count: comments.length, comments };
}

/* ------------------------------ Firecrawl ------------------------------- */

// This connection is direct-API mode: FIRECRAWL_API_KEY is a real Firecrawl
// key (fc-*) used as a bearer against api.firecrawl.dev — no gateway.
const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";

async function firecrawlPost(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${FIRECRAWL_V2}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("FIRECRAWL_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Firecrawl error ${response.status}: ${text.slice(0, 400)}`);
  return (text ? JSON.parse(text) : {}) as Record<string, unknown>;
}

async function firecrawlGet(path: string) {
  const response = await fetch(`${FIRECRAWL_V2}${path}`, {
    headers: { Authorization: `Bearer ${requireEnv("FIRECRAWL_API_KEY")}` },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Firecrawl error ${response.status}: ${text.slice(0, 400)}`);
  return (text ? JSON.parse(text) : {}) as Record<string, unknown>;
}

type FirecrawlDoc = {
  markdown?: string;
  summary?: string;
  title?: string;
  url?: string;
  description?: string;
  metadata?: { title?: string; sourceURL?: string; description?: string };
};

function unwrap(result: Record<string, unknown>): Record<string, unknown> {
  const data = result["data"];
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : result;
}

function docSummary(doc: FirecrawlDoc, chars = 4000) {
  return {
    title: doc.title ?? doc.metadata?.title ?? "",
    url: doc.url ?? doc.metadata?.sourceURL ?? "",
    description: doc.description ?? doc.metadata?.description ?? "",
    markdown: (doc.markdown ?? doc.summary ?? "").slice(0, chars),
  };
}

export async function firecrawlScrape(url: string, onlyMainContent = true) {
  const doc = unwrap(
    await firecrawlPost("/scrape", { url, formats: ["markdown"], onlyMainContent }),
  ) as FirecrawlDoc;
  return docSummary(doc);
}

export async function firecrawlSearch(query: string, limit = 5, scrapeContent = false) {
  const result = await firecrawlPost("/search", {
    query,
    limit: Math.min(Math.max(limit, 1), 20),
    ...(scrapeContent ? { scrapeOptions: { formats: ["markdown"] } } : {}),
  });
  const raw = result["data"];
  const items = Array.isArray(raw)
    ? (raw as FirecrawlDoc[])
    : (((raw as { web?: FirecrawlDoc[] } | undefined)?.web ?? []) as FirecrawlDoc[]);
  const results = items.map((doc) => docSummary(doc, scrapeContent ? 1500 : 400));
  return { count: results.length, results };
}

export async function firecrawlMap(url: string, search?: string, limit = 100) {
  const result = await firecrawlPost("/map", {
    url,
    ...(search ? { search } : {}),
    limit: Math.min(Math.max(limit, 1), 500),
  });
  const source = unwrap(result);
  const rawLinks = (source["links"] ?? result["links"] ?? []) as unknown[];
  const links = rawLinks
    .map((entry) =>
      typeof entry === "string" ? entry : String((entry as { url?: string })?.url ?? ""),
    )
    .filter(Boolean);
  return { count: links.length, links };
}

/** Starts a crawl and polls briefly; returns the job id if it is still running. */
export async function firecrawlCrawl(url: string, limit = 10, maxDepth?: number) {
  const start = await firecrawlPost("/crawl", {
    url,
    limit: Math.min(Math.max(limit, 1), 50),
    ...(maxDepth ? { maxDepth } : {}),
    scrapeOptions: { formats: ["markdown"] },
  });
  const jobId = String(start["id"] ?? "");
  if (!jobId) throw new Error("Firecrawl did not return a crawl id");

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const status = await firecrawlGet(`/crawl/${jobId}`);
    if (status["status"] === "completed") {
      const pages = ((status["data"] as FirecrawlDoc[] | undefined) ?? []).map((doc) =>
        docSummary(doc, 1500),
      );
      return { jobId, status: "completed", count: pages.length, pages };
    }
    if (status["status"] === "failed") {
      throw new Error(`Firecrawl crawl failed: ${String(status["error"] ?? "unknown error")}`);
    }
  }
  return {
    jobId,
    status: "running",
    note: "Crawl still running; check back with the job id.",
  };
}

/* ---------------------------- Action dispatch ---------------------------- */

export type ConnectorAction =
  | "gmail_search"
  | "gmail_read_message"
  | "gmail_send"
  | "slides_create"
  | "slides_read"
  | "slides_add_slide"
  | "fhir_search_patient"
  | "fhir_get_patient"
  | "fhir_get_appointments"
  | "fhir_get_medications"
  | "fhir_get_observations"
  | "reddit_search_subreddit"
  | "reddit_get_top_posts"
  | "reddit_get_post_comments"
  | "firecrawl_scrape"
  | "firecrawl_search"
  | "firecrawl_map"
  | "firecrawl_crawl";

type Args = Record<string, unknown>;
const str = (args: Args, key: string, fallback = "") => String(args[key] ?? fallback);
const num = (args: Args, key: string, fallback: number) =>
  Number.isFinite(Number(args[key])) ? Number(args[key]) : fallback;

export async function runConnectorAction(action: string, args: Args): Promise<unknown> {
  switch (action as ConnectorAction) {
    case "gmail_search":
      return gmailSearch(str(args, "query", "is:unread"), num(args, "limit", 10));
    case "gmail_read_message":
      return gmailReadMessage(str(args, "messageId"));
    case "gmail_send":
      return gmailSend(str(args, "to"), str(args, "subject"), str(args, "body"));
    case "slides_create":
      return slidesCreate(str(args, "title", "Untitled deck"));
    case "slides_read":
      return slidesRead(str(args, "presentationId"));
    case "slides_add_slide":
      return slidesAddSlide(
        str(args, "presentationId"),
        str(args, "title"),
        str(args, "body"),
      );
    case "fhir_search_patient":
      return fhirSearchPatient({
        name: args["name"] ? str(args, "name") : undefined,
        identifier: args["identifier"] ? str(args, "identifier") : undefined,
        limit: num(args, "limit", 10),
      });
    case "fhir_get_patient":
      return fhirGetPatient(str(args, "patientId"));
    case "fhir_get_appointments":
      return fhirGetAppointments(str(args, "patientId"), num(args, "limit", 10));
    case "fhir_get_medications":
      return fhirGetMedications(str(args, "patientId"), num(args, "limit", 20));
    case "fhir_get_observations":
      return fhirGetObservations(
        str(args, "patientId"),
        args["code"] ? str(args, "code") : undefined,
        num(args, "limit", 20),
      );
    case "reddit_search_subreddit":
      return redditSearchSubreddit(
        str(args, "query"),
        args["subreddit"] ? str(args, "subreddit") : undefined,
        num(args, "limit", 10),
      );
    case "reddit_get_top_posts":
      return redditGetTopPosts(str(args, "subreddit"), str(args, "timeframe", "week"), num(args, "limit", 10));
    case "reddit_get_post_comments":
      return redditGetPostComments(str(args, "postId"), num(args, "limit", 20));
    case "firecrawl_scrape":
      return firecrawlScrape(str(args, "url"), args["onlyMainContent"] !== false);
    case "firecrawl_search":
      return firecrawlSearch(
        str(args, "query"),
        num(args, "limit", 5),
        args["scrapeContent"] === true,
      );
    case "firecrawl_map":
      return firecrawlMap(
        str(args, "url"),
        args["search"] ? str(args, "search") : undefined,
        num(args, "limit", 100),
      );
    case "firecrawl_crawl":
      return firecrawlCrawl(
        str(args, "url"),
        num(args, "limit", 10),
        args["maxDepth"] ? num(args, "maxDepth", 2) : undefined,
      );
    default:
      throw new Error(`Unknown connector action: ${action}`);
  }
}
