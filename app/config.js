// Zentavo Web reads your own iCloud data straight from Apple with CloudKit JS.
// There is no Zentavo server: this page is static, and Apple asks you to sign in.
export const CONFIG = {
  containerIdentifier: 'iCloud.com.wilso.vaulta',
  // CloudKit Console → iCloud.com.wilso.vaulta → Tokens & Keys → API Tokens.
  // Public by design: it only identifies the app; your data still needs your Apple ID.
  apiToken: '',
  // 'development' while the app is built from Xcode; 'production' once the schema is deployed.
  environment: 'development',
  // Where SwiftData + CloudKit keeps every record.
  zoneName: 'com.apple.coredata.cloudkit.zone',
};
