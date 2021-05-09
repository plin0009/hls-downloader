# hls-downloader
Download large streams that use the HTTP Live Streaming (HLS) protocol, without hanging despite subpar internet connections.
I built this tool for personal use after trying multiple tools that hang after a single segment file takes too long to download.

## Features
* Queue multiple playlist files with one .json
* Retries downloads instead of hanging, aborting, or restarting
* Supports all output video formats as ffmpeg (.mp4, .mov, .avi, .ts, etc)

## To-do
* Make queueing files more user-friendly (GUI?)
* Take webpage URLs as input and scrape for .m3u8 file

## Prerequisites
* node v14.x.x or higher
* ffmpeg version 4.x

## To use
Place an `input.json` in the project directory, then run `npm start`.
Temporary files are placed in `./tmp/` and output files are placed in `./out/`, relative to the project directory.

An example `input.json`:

```
{
  "streams": [
    {
      "url": "https://.../playlist1.m3u8",
      "output": "video1.mp4"
    },
    {
      "url": "https://.../playlist2.m3u8",
      "output": "video2.mp4"
    }
  ]
}
```

## How it works
1. Downloads and reads master playlist .m3u8 (given by `"url"`) and chooses the first variant playlist
2. Downloads and reads variant playlist .m3u8 and downloads each segment file (.ts)
3. Save new playlist .m3u8 with references to downloaded segment files
4. Feeds new playlist .m3u8 into ffmpeg to produce the output file (given by `"output"`)

