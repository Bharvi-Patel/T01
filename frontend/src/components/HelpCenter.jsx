// HelpCenter.jsx — static FAQ/help content for T01, grouped into
// categories with a simple client-side search. No backend involved; this
// is reference content that ships with the app rather than user data.
import { useMemo, useState } from "react";

const SECTIONS = [
  {
    key: "getting-started",
    title: "Getting started",
    articles: [
      {
        q: "What does T01 actually do?",
        a: "T01 turns a topic into a ready-to-review social post: you give it a category and subtopic (or write one manually), it drafts the copy, you review and tweak it, then approve it for publishing — right away or on a schedule — to whichever connected platforms you pick.",
      },
      {
        q: "How do I connect my first platform?",
        a: "Go to Social Accounts in the sidebar and click Connect next to LinkedIn, Facebook, Instagram, Threads, or Finto. Most platforms take you through that platform's own login/authorization screen; once approved you'll land back in T01 connected.",
      },
      {
        q: "What do the draft statuses mean?",
        a: "Pending review — generated but not yet approved. Scheduled — approved and queued for a future date/time. Published — went out successfully. Publish failed — an attempt was made and at least one platform rejected it. Rejected — you declined the draft instead of approving it.",
      },
    ],
  },
  {
    key: "creating-content",
    title: "Creating content",
    articles: [
      {
        q: "How do I generate a post idea?",
        a: "From Dashboard or the + New button, pick a category and subtopic (or switch to manual mode to write your own from scratch). T01 drafts the copy for you to review before anything goes out.",
      },
      {
        q: "What's the difference between the Dashboard's Ideas and my own '+ New' ideas?",
        a: "The festival/observance ideas are pulled automatically from a calendar API to suggest timely post topics. Ideas you add yourself with '+ New' are just for you — give it a name, optional notes, and optional photos/videos to keep as a personal reference, separate from the auto-suggested ones.",
      },
      {
        q: "Can I edit a draft before it publishes?",
        a: "Yes — every generated draft goes to a review screen where you can edit the text, then approve, schedule, or reject it. Nothing publishes without that review step.",
      },
      {
        q: "Where do hashtag suggestions come from?",
        a: "T01 can suggest hashtags based on your draft's content when you're reviewing it — you can accept, edit, or ignore them.",
      },
    ],
  },
  {
    key: "scheduling",
    title: "Scheduling & publishing",
    articles: [
      {
        q: "What's the difference between scheduling and publishing live?",
        a: "Approving a draft with a future date/time queues it — T01 publishes it automatically when that time comes. Approving with 'live' publishes immediately to the platforms you selected.",
      },
      {
        q: "Can I reschedule or move a scheduled post?",
        a: "Yes — on the Calendar view you can drag a scheduled post to a new date, or open it to change the time directly. You can also unschedule it entirely, which sends it back to pending review.",
      },
      {
        q: "What happens if a publish attempt fails?",
        a: "The draft is marked publish failed and you'll see which platform(s) rejected it and why on the Drafts list. You can fix the issue (e.g. reconnect the platform) and retry from there.",
      },
    ],
  },
  {
    key: "media",
    title: "Media library",
    articles: [
      {
        q: "Where do my uploaded photos and videos live?",
        a: "The Publish page's Media tab keeps a permanent, per-account library of everything you've uploaded, so you can reuse the same assets across multiple posts instead of re-uploading each time.",
      },
      {
        q: "Are there file size or type limits?",
        a: "Yes — each file is capped at 50MB. Photos and videos are supported; you can also save plain text snippets to the library for reuse.",
      },
    ],
  },
  {
    key: "connections",
    title: "Connections & integrations",
    articles: [
      {
        q: "How do I disconnect a platform?",
        a: "On the Social Accounts page, each connected platform has a Disconnect option. Doing so stops future publishing to it, but doesn't affect posts that already went out.",
      },
      {
        q: "Why does a connection show as broken or need reconnecting?",
        a: "Platforms periodically expire the access they've granted (tokens), or a permission may have been revoked on their end. Reconnecting from Social Accounts refreshes that access.",
      },
    ],
  },
  {
    key: "inbox",
    title: "Social inbox",
    articles: [
      {
        q: "What shows up in the Inbox?",
        a: "Comments and direct messages from your connected Meta accounts (Instagram and Facebook) are pulled into one place so you don't have to check each platform separately.",
      },
      {
        q: "How does read/unread work?",
        a: "New comments and DMs arrive unread; opening a conversation marks it read. This is just for your own tracking within T01 — it doesn't mark anything read on the platform itself.",
      },
    ],
  },
  {
    key: "analytics",
    title: "Analytics",
    articles: [
      {
        q: "What do the analytics numbers mean?",
        a: "They're built entirely from T01's own publish attempts — total drafts, success rate, a breakdown by platform, posting cadence by weekday, and recent failures — over the date range you pick.",
      },
      {
        q: "Does T01 show followers or reach?",
        a: "No — T01 doesn't call any platform's insights API, so you won't see follower counts, impressions, or engagement metrics here, only what T01 itself knows about your publishing activity.",
      },
    ],
  },
  {
    key: "notifications",
    title: "Notifications",
    articles: [
      {
        q: "What notification types can I control?",
        a: "Before publish, needs approval, publish failed, and a weekly digest — each can be toggled independently from the Notifications page.",
      },
      {
        q: "Do I need to enable push notifications in my browser?",
        a: "Yes — T01 uses your browser's push permission to deliver notifications, so you'll be prompted to allow it the first time you turn a notification type on.",
      },
    ],
  },
  {
    key: "account",
    title: "Account & settings",
    articles: [
      {
        q: "How do I verify my email?",
        a: "After signing up, T01 emails you a verification link — your account stays unverified (and can't sign in) until you click it. Didn't get it? Use the resend option on the sign-in screen.",
      },
      {
        q: "How do I change my password?",
        a: "From your account menu, choose the password change option and follow the prompts.",
      },
    ],
  },
];

function ChevronIcon({ open }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s ease", flexShrink: 0 }}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function Article({ article, open, onToggle }) {
  return (
    <div style={{ borderBottom: "0.5px solid var(--border-strong)" }}>
      <button
        onClick={onToggle}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          padding: "12px 4px", background: "none", border: "none", textAlign: "left", cursor: "pointer",
          color: "var(--ink)", fontSize: 13.5, fontWeight: 500,
        }}
      >
        <span>{article.q}</span>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <p style={{ margin: "0 4px 14px", fontSize: 13, lineHeight: 1.55, color: "var(--text-secondary)" }}>
          {article.a}
        </p>
      )}
    </div>
  );
}

function SectionBlock({ section, openKey, onToggle }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <p style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--ink)", margin: "0 0 6px" }}>
        {section.title}
      </p>
      <div
        style={{
          background: "var(--paper-raised)", border: "0.5px solid var(--border-strong)",
          borderRadius: 8, padding: "0 14px",
        }}
      >
        {section.articles.map((article, i) => {
          const articleKey = `${section.key}-${i}`;
          return (
            <Article
              key={articleKey}
              article={article}
              open={openKey === articleKey}
              onToggle={() => onToggle(openKey === articleKey ? null : articleKey)}
            />
          );
        })}
      </div>
    </div>
  );
}

export default function HelpCenter() {
  const [query, setQuery] = useState("");
  const [openKey, setOpenKey] = useState(null);

  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.map((section) => ({
      ...section,
      articles: section.articles.filter(
        (a) => a.q.toLowerCase().includes(q) || a.a.toLowerCase().includes(q)
      ),
    })).filter((section) => section.articles.length > 0);
  }, [query]);

  return (
    <div style={{ maxWidth: 640 }}>
      <p style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--ink)", margin: "0 0 4px" }}>
        Help center
      </p>
      <p style={{ fontSize: 13.5, color: "var(--text-secondary)", margin: "0 0 20px" }}>
        Answers to common questions about using T01.
      </p>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search help articles…"
        style={{ width: "100%", marginBottom: 24, boxSizing: "border-box" }}
      />

      {filteredSections.length === 0 && (
        <p style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>
          No articles match "{query}". Try a different search term.
        </p>
      )}

      {filteredSections.map((section) => (
        <SectionBlock key={section.key} section={section} openKey={openKey} onToggle={setOpenKey} />
      ))}
    </div>
  );
}