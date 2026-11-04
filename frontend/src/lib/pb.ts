import PocketBase from 'pocketbase'

export const pbUrl: string =
  import.meta.env.VITE_PB_URL ?? `${location.protocol}//${location.hostname}:8090`

export const pb = new PocketBase(pbUrl)

// Several components (Lobby, TopBar, useRoomInfo) legitimately issue identical requests
// at once; the SDK's default would cancel all but the last with "The request was aborted".
pb.autoCancellation(false)
