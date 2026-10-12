# Listing Nadeye in Monad's protocol registry

[monad-crypto/protocols](https://github.com/monad-crypto/protocols) is the Monad Foundation's list of protocols on Monad, with their contract addresses and links. Projects add themselves by pull request.

`nadeye.jsonc` is Nadeye's entry. It is ready except for the values you only have after launch, so it fails validation until they are filled in.

## After you deploy

1. In `nadeye.jsonc`, replace `0xYOUR_NADEYE_ADDRESS`, `0xYOUR_PASSKEYS_ADDRESS` and `0xYOUR_JOURNAL_ADDRESS` with the three deployed contracts and `https://YOUR_SITE_URL` with the hosted site. Add a `"twitter"` link if Nadeye gets its own X account.
2. Verify both contracts' source on [testnet.monadvision.com](https://testnet.monadvision.com/) (or monadvision.com on mainnet). The registry asks for this and checks it.
3. Fork `monad-crypto/protocols` to your GitHub account, then:

```bash
git clone https://github.com/<you>/protocols && cd protocols
git checkout -b nadeye/add-protocol
cp /path/to/nadeye/ecosystem/monad-protocols/nadeye.jsonc testnet/nadeye.jsonc   # or mainnet/ once it's there
pip install json5
python scripts/validate_protocol.py --network testnet --protocol nadeye   # silent and exit 0 means it passed
git add testnet/nadeye.jsonc && git commit -m "Add Nadeye" && git push origin nadeye/add-protocol
```

4. Open a pull request from your fork's branch into `monad-crypto/protocols:main`, and request a review from the Monad Foundation reviewers listed in their README.

## Why these fields

- **Categories.** `AI::Infrastructure` comes first because Nadeye is a registry other apps and agents build on. `Infra::Identity` covers the PasskeyRegistry and ERC-8004 reputation. `AI::Consumer AI` covers the extension, the reference client.
- **Addresses.** Only Nadeye's own contracts are listed. The ERC-8004 registries it uses already have their own entry (`mainnet/erc_8004.jsonc`).
