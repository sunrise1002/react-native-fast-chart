/* global beforeAll */
// Reanimated queues its frame-callback registry setup on the mocked UI loop
// at import time, using real timers. Let it run before a suite switches to
// fake timers, otherwise the first `useFrameCallback` in a file crashes.
beforeAll(() => new Promise((resolve) => setTimeout(resolve, 20)));
