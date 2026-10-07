const activeOffers = document.querySelector("#active-offers");
const openingList = document.querySelector("#opening-list");
const waitlist = document.querySelector("#waitlist");
const formFeedback = document.querySelector("#form-feedback");
const startOffersButton = document.querySelector("#start-offers");
const schedulerHint = document.querySelector("#scheduler-hint");
let snapshot;
let renderedState;
let connectionFailed = false;
let pendingOpeningRequest;
const replyFeedback = document.querySelector("#reply-feedback");
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
document.querySelector("#timezone-hint").textContent = `Times use ${timeZone.replaceAll("_", " ")}.`;

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) {
    document.querySelector("main").hidden = true;
    location.replace("/login?expired=1");
    throw new Error("Please sign in again.");
  }
  if (!response.ok) throw new Error(body.error || "The request could not be completed.");
  return body;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(value));
}

function statusLabel(status, squareUpdatedAt) {
  if (status === "booked" && squareUpdatedAt) return "Accepted · checklist done";
  return ({
    queued: "Queued", offering: "Offer sent", booked: "Accepted · update Square",
    closed: "Closed", unfilled: "No match yet", waiting: "Awaiting reply",
    "needs-follow-up": "Staff follow-up", accepted: "Accepted", declined: "Declined",
    expired: "Timed out", cancelled: "Cancelled",
  })[status] || status;
}

function renderWaitlist(entries) {
  const optedIn = entries.filter((entry) => entry.optedIn);
  const optedOut = entries.filter((entry) => !entry.optedIn);
  document.querySelector("#waitlist-count").textContent = `${optedIn.length} opted in`;
  waitlist.innerHTML = [...optedIn, ...optedOut].map((entry) => `
    <article class="waitlist-row ${entry.optedIn ? "" : "opted-out"}">
      <span class="avatar">${escapeHtml(entry.name.split(" ").map((part) => part[0]).join(""))}</span>
      <div class="client-info"><strong>${escapeHtml(entry.name)}</strong><span>${escapeHtml(entry.service)} · ${escapeHtml(entry.stylistPreference)}</span><small>${escapeHtml(entry.availability)} · joined ${formatDateTime(entry.joinedAt)}</small></div>
      <span class="opt-status">${entry.optedIn ? "Opted in" : "Opted out"}</span>
    </article>`).join("");
}

function renderOpenings(openings, offersRunning) {
  const queued = openings.filter((opening) => opening.status === "queued");
  startOffersButton.disabled = queued.length === 0 || offersRunning;
  startOffersButton.textContent = offersRunning
    ? "Offers move forward automatically"
    : `Start sequential offers · ${queued.length} opening${queued.length === 1 ? "" : "s"} →`;
  schedulerHint.textContent = offersRunning
    ? "New openings join the queue; replies, timeouts, and staff cancellations move it forward."
    : "Add all current openings, then start offers. Earlier appointment times go first.";

  if (!openings.length) {
    openingList.innerHTML = '<div class="empty-state compact"><strong>No openings queued</strong><p>New cancellations will appear here.</p></div>';
    return;
  }
  const ordered = [...openings].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  openingList.innerHTML = ordered.map((opening) => `
    <article class="opening-row">
      <span class="opening-icon" aria-hidden="true">${opening.status === "booked" ? "✓" : "◷"}</span>
      <div class="opening-info"><strong>${escapeHtml(opening.service)} with ${escapeHtml(opening.stylist)}</strong><span>${escapeHtml(opening.displayTime)} · ${opening.durationMinutes} min</span><small>${escapeHtml(opening.note)}</small><a class="text-action" href="/openings/${encodeURIComponent(opening.id)}">View details and timeline</a>${squareChecklist(opening)}${["queued", "unfilled"].includes(opening.status) ? `<button class="text-action danger" data-action="cancel" data-still-open="false" data-opening="${escapeHtml(opening.id)}">Close opening</button>` : ""}</div>
      <span class="status-pill status-${escapeHtml(opening.status)}">${opening.squareUpdatedAt ? "Accepted · checklist done" : escapeHtml(statusLabel(opening.status, opening.squareUpdatedAt))}</span>
    </article>`).join("");
}

function squareChecklist(opening) {
  if (opening.status !== "booked") return "";
  const client = snapshot.waitlist.find(entry => entry.id === opening.bookedClientId)?.name || "Accepted client";
  return `<div class="handoff"><strong>Update Square manually</strong><p>${escapeHtml(client)} · ${escapeHtml(opening.service)} with ${escapeHtml(opening.stylist)} · ${escapeHtml(opening.displayTime)} · ${opening.durationMinutes} minutes</p><p>${opening.squareUpdatedAt ? `Marked done by ${escapeHtml(opening.squareUpdatedBy)} at ${formatDateTime(opening.squareUpdatedAt)}.` : "Front desk: update the official calendar, then mark this checklist done."}</p><button class="button button-outline" data-action="square" data-opening="${escapeHtml(opening.id)}" data-completed="${!opening.squareUpdatedAt}">${opening.squareUpdatedAt ? "Reopen Square checklist" : "Mark manual Square update done"}</button><small>This only records your checklist status here. It does not connect to Square.</small></div>`;
}

function renderMessages(messages) {
  if (!messages?.length) return '<p class="panel-copy">No recorded simulated messages yet.</p>';
  return `<ol class="message-timeline">${messages.slice().reverse().map(message => `<li><span class="simulated-label">SIMULATED ${escapeHtml(message.direction.toUpperCase())}</span><small>${formatDateTime(message.at)}${message.clientName ? ` · ${escapeHtml(message.clientName)}` : ""} · ${escapeHtml(message.openingId)}</small><p>${escapeHtml(message.text)}</p></li>`).join("")}</ol>`;
}

function renderDetail(data) {
  const match = location.pathname.match(/^\/openings\/([^/]+)\/?$/);
  if (!match) return;
  document.body.classList.add("detail-view");
  document.querySelector("#dashboard-layout").hidden = true;
  const panel = document.querySelector("#opening-detail");
  panel.hidden = false;
  const opening = data.openings.find(o => o.id === decodeURIComponent(match[1]));
  if (!opening) { panel.innerHTML = '<a href="/">← Back to dashboard</a><h2>Opening not found</h2>'; return; }
  const offers = data.offers.filter(o => o.openingId === opening.id);
  const current = offers.find(o => o.id === opening.currentOfferId);
  const holder = data.waitlist.find(entry => entry.id === opening.bookedClientId)?.name;
  panel.innerHTML = `<a href="/" class="text-action">← Back to dashboard</a><h2>${escapeHtml(opening.service)} with ${escapeHtml(opening.stylist)}</h2><p>${escapeHtml(opening.displayTime)} · ${opening.durationMinutes} minutes · ${escapeHtml(statusLabel(opening.status, opening.squareUpdatedAt))}</p><p><strong>Who holds it: ${escapeHtml(holder || "Nobody yet")}</strong></p><p>${escapeHtml(opening.note)}</p>${squareChecklist(opening)}<h3>Current offer</h3>${current ? renderOfferCard(current, opening) : '<p>No active offer.</p>'}<h3>Offer history</h3><ol class="message-timeline">${offers.map(offer => `<li><strong>${escapeHtml(offer.clientName)} · ${escapeHtml(statusLabel(offer.status))}</strong><small>Sent: ${offer.sentAt ? formatDateTime(offer.sentAt) : "Not recorded in older history"} · Deadline: ${formatDateTime(offer.deadlineAt)}${offer.respondedAt ? ` · Reply: ${formatDateTime(offer.respondedAt)}` : ""}</small></li>`).join("") || '<li>No offers yet.</li>'}</ol><h3>Simulated message timeline</h3>${renderMessages((data.messages || []).filter(message => message.openingId === opening.id))}<p class="form-feedback" id="detail-feedback" role="status"></p>`;
}

function renderOfferCard(offer, opening) {
  const active = ["waiting", "needs-follow-up"].includes(offer.status);
  const detail = opening ? `${formatDateTime(offer.startsAt)} · ${offer.service} with ${offer.stylist}` : `${formatDateTime(offer.startsAt)} · ${offer.service}`;
  return `
    <article class="offer-card ${active ? "is-active" : "is-history"}" data-offer-id="${escapeHtml(offer.id)}">
      <div class="offer-card-head"><span class="simulated-label">SIMULATED MESSAGE</span><span class="status-pill status-${escapeHtml(offer.status)}">${escapeHtml(statusLabel(offer.status))}</span></div>
      <div class="offer-person"><span class="avatar">${escapeHtml(offer.clientName.split(" ").map((part) => part[0]).join(""))}</span><div><strong>${escapeHtml(offer.clientName)}</strong><span>${escapeHtml(detail)}</span></div></div>
      <p class="message-preview">${escapeHtml(offer.message)}</p>
      <p class="client-link-row"><a class="button button-secondary" href="${escapeHtml(offer.clientUrl)}" target="_blank" rel="noopener noreferrer">Open client offer page ↗</a><small>Personal offer link · simulated delivery</small></p>
      ${offer.lastReply ? `<p class="reply-outcome">${escapeHtml(offer.lastReply.message)}</p>` : ""}
      ${active ? `
        <p class="deadline">Reply window ends ${formatDateTime(offer.deadlineAt)}. The opening is not reserved until a clear acceptance.</p>
        <div class="client-actions" aria-label="Simulated client response">
          <button class="button button-accept" data-action="reply" data-kind="accept" data-id="${escapeHtml(offer.id)}">Simulate clear “yes”</button>
          <button class="button button-outline" data-action="reply" data-kind="decline" data-id="${escapeHtml(offer.id)}">Simulate decline</button>
          <button class="text-action" data-action="reply" data-kind="question" data-id="${escapeHtml(offer.id)}">Simulate a question</button>
        </div>
        ${offer.status === "needs-follow-up" ? '<p class="follow-up-note">Staff should follow up. This does not reserve the opening; the original reply deadline still applies.</p>' : ""}
        <div class="staff-actions">
          <button class="text-action" data-action="cancel" data-id="${escapeHtml(offer.id)}" data-still-open="true" data-opening="${escapeHtml(offer.openingId)}">Cancel offer · try next</button>
          <button class="text-action danger" data-action="cancel" data-id="${escapeHtml(offer.id)}" data-still-open="false" data-opening="${escapeHtml(offer.openingId)}">Close opening</button>
        </div>` : `<button class="text-action" data-action="reply" data-kind="accept" data-id="${escapeHtml(offer.id)}">${offer.status === "accepted" ? "Simulate repeated acceptance" : "Simulate late acceptance"}</button>`}
    </article>`;
}

function renderOffers(offers, openings) {
  const active = offers.filter((offer) => ["waiting", "needs-follow-up"].includes(offer.status));
  const recent = offers.filter((offer) => !["waiting", "needs-follow-up"].includes(offer.status)).slice().reverse();
  document.querySelector("#active-count").textContent = `${active.length} active`;
  const byId = new Map(openings.map((opening) => [opening.id, opening]));
  if (!active.length && !recent.length) {
    activeOffers.innerHTML = '<div class="empty-state"><span class="empty-icon" aria-hidden="true">✦</span><strong>No offers yet</strong><p>Add a cancellation, then start the offer queue.</p></div>';
    return;
  }
  activeOffers.innerHTML = [
    ...active.map((offer) => renderOfferCard(offer, byId.get(offer.openingId))),
    ...(recent.length ? [`<div class="history-heading">Recent simulated outcomes</div>`, ...recent.map((offer) => renderOfferCard(offer, byId.get(offer.openingId)))] : []),
  ].join("");
}

function render(data) {
  snapshot = data;
  document.querySelector("#simulation-time").textContent = formatDateTime(data.clockNow || new Date().toISOString());
  const { clockNow, ...stableData } = data;
  const next = JSON.stringify(stableData);
  if (next === renderedState) return; // Polling must not discard a focused button.
  renderedState = next;
  renderWaitlist(data.waitlist);
  renderOpenings(data.openings, data.offersRunning);
  renderOffers(data.offers, data.openings);
  document.querySelector("#message-inbox").innerHTML = renderMessages(data.messages);
  renderDetail(data);
}

async function refresh() {
  try {
    render(await api("/api/salon"));
    if (connectionFailed) formFeedback.textContent = "Connected to the local app again.";
    connectionFailed = false;
  } catch (error) {
    connectionFailed = true;
    formFeedback.textContent = `Couldn’t reach the local Temporal app: ${error.message}`;
  }
}

document.querySelector("#opening-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  formFeedback.textContent = "Adding opening…";
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const startsAt = new Date(values.get("startsAt")).toISOString();
    const input = {
      service: values.get("service"), stylist: values.get("stylist"), startsAt, timeZone,
      offerUntil: values.get("offerUntil") ? new Date(values.get("offerUntil")).toISOString() : undefined,
      durationMinutes: Number(values.get("durationMinutes")), responseMinutes: Number(values.get("responseMinutes")),
    };
    const fingerprint = JSON.stringify(input);
    if (pendingOpeningRequest?.fingerprint !== fingerprint) pendingOpeningRequest = { fingerprint, requestId: crypto.randomUUID() };
    const result = await api("/api/openings", {
      method: "POST",
      body: JSON.stringify({ ...input, requestId: pendingOpeningRequest.requestId }),
    });
    pendingOpeningRequest = undefined;
    formFeedback.textContent = result.code === "duplicate" ? "Opening added previously. The existing opening is shown below." : snapshot?.offersRunning ? "Opening added. The offer queue is running automatically." : "Opening added. Add any other cancellations, then start the offer queue.";
    await refresh();
  } catch (error) {
    formFeedback.textContent = error.message;
  } finally { submit.disabled = false; }
});

startOffersButton.addEventListener("click", async () => {
  try {
    await api("/api/offers/start", { method: "POST", body: "{}" });
    formFeedback.textContent = "Offer queue started. Temporal will keep each reply deadline and move to the next eligible client.";
    await refresh();
  } catch (error) {
    formFeedback.textContent = error.message;
  }
});

async function handleAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  button.disabled = true;
  try {
    if (button.dataset.action === "reply") {
      const outcome = await api(`/api/offers/${encodeURIComponent(button.dataset.id)}/reply`, {
        method: "POST",
        body: JSON.stringify({
          kind: button.dataset.kind,
          message: button.dataset.kind === "question" ? "Can you tell me a little more?" : undefined,
        }),
      });
      replyFeedback.textContent = outcome.message;
    } else if (button.dataset.action === "cancel") {
      await api(`/api/openings/${encodeURIComponent(button.dataset.opening)}/cancel`, {
        method: "POST",
        body: JSON.stringify({
          stillOpen: button.dataset.stillOpen === "true",
          offerId: button.dataset.id,
          reason: button.dataset.stillOpen === "true" ? "Staff cancelled this client offer" : "The appointment is no longer practical or available",
        }),
      });
      replyFeedback.textContent = "Staff cancellation recorded. Check the opening status below.";
    } else if (button.dataset.action === "square") {
      await api(`/api/openings/${encodeURIComponent(button.dataset.opening)}/square`, { method: "POST", body: JSON.stringify({ completed: button.dataset.completed === "true" }) });
      replyFeedback.textContent = "Manual Square checklist updated. No connection to Square was made.";
    }
    await refresh();
    const detailFeedback = document.querySelector("#detail-feedback");
    if (detailFeedback) detailFeedback.textContent = replyFeedback.textContent;
  } catch (error) {
    replyFeedback.textContent = error.message;
    const detailFeedback = document.querySelector("#detail-feedback");
    if (detailFeedback) detailFeedback.textContent = error.message;
  } finally { button.disabled = false; }
}
activeOffers.addEventListener("click", handleAction);
openingList.addEventListener("click", handleAction);
document.querySelector("#opening-detail").addEventListener("click", handleAction);
document.querySelector("#advance-clock").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api("/api/simulation/advance", { method: "POST", body: JSON.stringify({ minutes: 15 }) });
    document.querySelector("#clock-feedback").textContent = "Simulation advanced 15 minutes. Due offers expired and the queue moved forward.";
    await refresh();
  } catch (error) { document.querySelector("#clock-feedback").textContent = error.message; }
  finally { button.disabled = false; }
});

function setDefaultDate() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setHours(15, 0, 0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  document.querySelector("#starts-at").value = local.toISOString().slice(0, 16);
}

setDefaultDate();
let refreshTimer;
async function startDashboard() {
  try {
    const { staff } = await api("/api/auth/session");
    document.querySelector("#staff-name").textContent = `Signed in as ${staff === "lena" ? "Lena" : "Carla"}`;
    await refresh();
    refreshTimer = setInterval(refresh, 2000);
  } catch (error) { formFeedback.textContent = error.message; }
}
document.querySelector("#sign-out").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
    clearInterval(refreshTimer);
    document.querySelector("main").hidden = true;
    location.replace("/login");
  } catch (error) { formFeedback.textContent = error.message; }
});
window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
startDashboard();
