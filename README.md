# NITKnot v2.0 — Production-Ready Campus Dating App

## 🚀 What's Fixed (vs Original)

### Critical Bug Fixes
1. **Static files**: Server now correctly serves from `public/` directory
2. **Match socket**: `match_found` event now sends correct `{ match_id, user }` structure
3. **Swipe response**: Frontend correctly reads `data.match`, `data.match_id`, `data.matched_user`
4. **`closeMatch()`/`goToChat()`**: Were on `App` object, never callable from HTML — fixed as global functions
5. **Voice messages**: Fixed FormData upload with proper audio MIME type handling
6. **`retrySend`**: Referenced `window._tempMsgs` which was never populated — completely rewritten
7. **Nav badge**: Chat unread count badge now works
8. **Typing indicators**: Socket handlers properly re-bound per conversation
9. **Image viewer**: Full-screen image viewer added for chat images
10. **Emoji picker**: Replaced broken `picmo` (not loaded) with inline emoji buttons
11. **Message deduplication**: Polling no longer causes duplicate messages
12. **Profile edit**: Interests now properly editable, green/red flags saveable
13. **Date separators**: Chat now shows date separators (Today, Mon, Jan 1, etc.)
14. **Error states**: All pages now show proper error UI with retry buttons
15. **Auth token key**: Changed from `nitknot_token` to `nk_token` (consistent)
16. **Input validation**: Proper XSS protection via `escapeHtml()` everywhere
17. **Drag/swipe**: Improved with velocity detection, vertical scroll not interfering
18. **Report modal**: Properly styled bottom sheet with reasons
19. **Unmatch**: Moved to chat header menu (more_vert)
20. **Server**: Audio files use disk storage even with Cloudinary (avoids format issues)

### New Features
- ✅ Unread message badge on chat nav item
- ✅ Chat search/filter
- ✅ Image preview before sending
- ✅ Date separators in chat
- ✅ Inline emoji picker (no external dependency)
- ✅ Full-screen image viewer (tap to expand)
- ✅ Retry button for failed messages
- ✅ Show "you: " prefix for own messages in chat list
- ✅ Report from profile view AND message options
- ✅ Match percentage randomized when no shared interests (not always 70%)
- ✅ Proper loading spinners everywhere
- ✅ Error states with retry on every page

## Quick Start

```bash
npm install
npm start
```

Open http://localhost:3000

## Production (Render)

1. Push to GitHub
2. Create Render web service + PostgreSQL database
3. Set env vars: `JWT_SECRET`, `DATABASE_URL` (auto from Render DB)
4. Optional: `CLOUDINARY_*` for persistent image storage
5. Optional: `SENDGRID_API_KEY` or `SMTP_EMAIL`/`SMTP_PASSWORD` for OTP email

## Dev Note
In development (no email configured), OTP is logged to console:
```
⚠️  DEV MODE — OTP for user@nitk.edu.in: 123456
```
