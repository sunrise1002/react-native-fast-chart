module.exports = {
  overrides: [
    {
      exclude: /\/node_modules\//,
      presets: ['module:react-native-builder-bob/babel-preset'],
    },
    {
      include: /\/node_modules\//,
      presets: ['module:@react-native/babel-preset'],
    },
  ],
  env: {
    // Jest only: workletize like the host app's build does, so Reanimated
    // mappers see their shared-value inputs. The published library ships
    // plain 'worklet' directives (the app's Babel plugin handles them).
    test: {
      plugins: ['react-native-worklets/plugin'],
    },
  },
};
