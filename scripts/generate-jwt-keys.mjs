import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

const keys = await generateKeyPair("RS256", { extractable: true });
const privateKey = await exportPKCS8(keys.privateKey);
const publicKey = await exportJWK(keys.publicKey);
const jwks = JSON.stringify({ keys: [{ use: "sig", ...publicKey }] });

console.log("\n=== JWT_PRIVATE_KEY (copy everything between the quotes) ===\n");
console.log(privateKey);
console.log("\n=== JWKS (copy everything between the quotes) ===\n");
console.log(jwks);
console.log("\n=== ENVIRONMENT VARIABLES TO SET ===\n");
console.log(`SITE_URL=https://www.koushikkoushik.com`);
console.log(`JWT_PRIVATE_KEY=<paste the private key above, replacing newlines with spaces>`);
console.log(`JWKS=<paste the jwks above>`);
console.log(`AUTH_GITHUB_ID=<your_github_oauth_client_id>`);
console.log(`AUTH_GITHUB_SECRET=<your_github_oauth_client_secret>`);
