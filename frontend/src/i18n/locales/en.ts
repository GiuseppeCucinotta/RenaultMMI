export const en = {
  nav: {
    home: "Home",
    phone: "Phone",
    media: "Media",
  },
  apps: {
    fuel: "Fuel",
    equalizer: "Equalizer",
    playlist: "Playlist",
    speedometer: "Speedometer",
    history: "History",
    camera: "Camera",
    parking: "Parking",
    settings: "Settings",
  },
  media: {
    noMedia: "No Media",
    noSource: "No source",
    sources: {
      bluetooth: "Bluetooth",
      cd: "CD",
      fm: "FM",
      jukebox: "Jukebox",
    },
    bluetooth: {
      noPhoneConnected: "No phone connected",
    },
    cd: {
      noDisc: "No disc",
    },
    audioSourcesAria: "Audio sources",
    player: {
      library: "Library",
      nowPlaying: "Now playing",
      backToLibrary: "Back to album library",
      backToNowPlaying: "Return to now playing",
      previousTrack: "Previous track",
      play: "Play",
      pause: "Pause",
      nextTrack: "Next track",
      playbackPosition: "Playback position",
      closeQueue: "Close queue",
    },
    jukebox: {
      scanningTitle: "Scanning library",
      scanningHint: "Reading your music folder. This only happens once.",
      errorTitle: "Something went wrong",
      retryScan: "Retry scan",
      emptyTitle: "No music yet",
      emptyHint: "Drop your albums into the music folder on the car, then scan for it.",
      scan: "Scan",
      libraryAria: "Jukebox album library",
      playAlbum: "Play {title} by {artist}",
      queue: "Queue",
      queueAria: "Upcoming tracks",
      playingNow: "Now playing",
      currentTrack: "Current track",
      trackCount: "tracks",
      playTrackInQueue: "Skip to {title}",
    },
  },
  car: {
    statusOk: "OK",
    title: "Car",
    wireframeAlt: "Vehicle wireframe",
  },
} as const;

type DeepStringify<T> = {
  [K in keyof T]: T[K] extends object ? DeepStringify<T[K]> : string;
};

export type Messages = DeepStringify<typeof en>;
