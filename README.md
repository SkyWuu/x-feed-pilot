# X Feed Pilot (XFP)

English | [简体中文](README_zh.md)

X Feed Pilot lets you steer X's recommendation algorithm so your For You timeline reflects the topics you want to see.

## Why use it?

X is one of my favorite sources of information. Its recommendations pick up on what you spend time reading and surface timely posts, much like TikTok.

But two things make it hard to use X for discovering topics:

1. **Search works poorly for exploring a field.** It can find a specific post, but a search for what developers have built with Jev lately tends to return popular posts or secondhand summaries instead of a useful range of current work.
2. **Your For You timeline learns from what you do, which may differ from what you want to read.** I wanted more posts from English-speaking accounts, yet about half my timeline stayed in Chinese because I spent longer on Chinese posts. The same thing happens when you linger on posts you would rather see less often. X keeps recommending them.

X Feed Pilot gives you a way to push those recommendations toward your stated preferences, such as fewer Chinese-language posts or more posts about new models.

## How does XFP work?

1. XFP browses, searches, reads, and interacts with posts on your behalf. Those actions give X's recommendation algorithm signals about the content you want to see.
2. You describe what you want in your timeline.
3. XFP saves the posts it encounters and marks the ones it judges relevant, so you can review them on a local reading page.



## Run it locally

XFP is an early-stage macOS app. A Chrome extension uses an X account you have signed in to. A local service calls the Jev model to judge each post, then the extension acts on that judgment by skipping, reading, liking, or saving posts. Reading history stays on your computer.

### Requirements

- macOS, Google Chrome, Node.js 20+, Python 3, and Clang with access to Apple's Vision framework
- A TypeSafe API key
- An X account signed in through Chrome; a separate account is recommended for training
- Your preferences in [PREFERENCE.md](PREFERENCE.md), which XFP uses to guide recommendations
- Search terms in [search-seeds.json](search-seeds.json). If your timeline has no posts that match your preferences, XFP can search these terms to get started. You can ask an agent to draft the file after writing your preferences.

From the project root, run:

```sh
npm install
cp .env.example .env
# Add TYPESAFE_API_KEY to .env
npm run build
npm start
```

You can also provide the key through the `TYPESAFE_API_KEY` environment variable. A nonempty value in `.env` takes precedence. The local service listens on `127.0.0.1:47831`.

### Use it

1. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `dist/extension/` from this project.
2. Sign in to X in Chrome and open `x.com`. Click the extension icon, then **Start session**.
3. **Keep the Chrome window and training tab in the foreground.** Collection and the session timer pause when you switch to another app or tab, then resume when you return. You can stop a session from the extension at any time.
4. Open the [local reading page](http://127.0.0.1:47831/) in a browser or Chrome profile signed in to a different X account. Training pauses while you view the page and resumes when you return to the training tab.

Each session runs for up to 10 minutes or 80 posts, with limits of 8 likes and 4 bookmarks. Starting again after stopping creates a new session. Restarting the service ends any unfinished session. Records are stored in `data/pilot.sqlite`, which Git ignores.

### How it's built

- The [Chrome extension](src/extension/) reads the recommendation feed and search results, browses and interacts with posts, and pauses when the training tab loses focus.
- The [local service](src/server/) manages sessions and action limits. It passes post text, image text extracted with Apple Vision, and content from links or mentioned accounts visited as needed to Jev to judge whether a post matches your preferences. It skips posts marked as ads.
- The [reading page](src/server/public/) shows the records and judgments saved in SQLite. It uses X's embed widget to show the original post and falls back to a local text snapshot if the embed fails.



### Contributing

Run `npm test` to build the project and run the automated tests. After changing the extension, run `npm run build` again, reload it in `chrome://extensions`, and restart the local service. Changes to X page interactions also need manual testing in a signed-in Chrome session. When submitting a PR, describe the behavior change and test results; include screenshots for popup or reading-page changes.

### Known limitations

Jev works with text, and Apple Vision extracts text from images. Images without enough accompanying text and videos without captions may be marked as having insufficient evidence. XFP automates actions on X, including likes and bookmarks. This may violate X's rules and restrict the training account.
