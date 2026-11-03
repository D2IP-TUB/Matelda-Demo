import PocketBase from 'pocketbase'

export const pbUrl: string =
  import.meta.env.VITE_PB_URL ?? `${location.protocol}//${location.hostname}:8090`

export const pb = new PocketBase(pbUrl)
