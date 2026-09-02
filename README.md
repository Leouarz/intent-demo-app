# Intent demo app

Run the middleware first on `http://localhost:4050`.

```sh
cd /intent-demo-app
npm install
npm run dev
```

Set `NEXT_PUBLIC_MIDDLEWARE_URL` if the middleware is not on `http://localhost:4050`.
Open the printed local URL, connect MetaMask, request a quote, then run the demo flow.

The provider selector includes `nexus-v2`, Mayan, and Relay. Relay supports exact-output source
aggregation and provider-managed destination gas top-ups; enter a native gas-drop amount in the
advanced options to include one (Relay converts it to USD and caps it at $2.00).
