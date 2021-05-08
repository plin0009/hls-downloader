import http from "http";
import https from "https";
import fs from "fs";
import path from "path";
import rl from "readline";
import { exec } from "child_process";

const __dirname = path.resolve();

const download = async (url, filePath) => {
  return await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filePath);
    const request = (url.startsWith("https") ? https : http)
      .get(url)
      .on("response", (res) => {
        res.pipe(file);
        file.on("finish", () => {
          resolve(filePath);
        });
      })
      .on("error", (err) => {
        fs.unlink(filePath, () => {
          reject(err);
        });
      });
    request.setTimeout(10000, () => {
      request.socket.destroy();
      request.destroy();
      fs.unlink(filePath, () => {
        reject("socket timeout");
      });
    });
  });
};

const readFile = async (filePath) => {
  return await fs.promises.readFile(filePath, { encoding: "utf8" });
};

const writeFile = async (data, filePath) => {
  await fs.promises.writeFile(filePath, data);
  return filePath;
};

// returns first playlist file
const scanMasterPlaylist = (data) => {
  const lines = data.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(/\.m3u8$/)) {
      return line;
    }
  }
};

// downloads all segments (.ts files) and returns new m3u8
const scanPlaylist = async (data) => {
  const newPlaylistDataLines = [];
  const lines = data.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(/\.ts$/)) {
      // we need the segment
      const segmentFilename = line.match(/.*\/(.*)$/)[1];
      // check if file exists
      const segmentFilepath = path.join(__dirname, `./tmp/${segmentFilename}`);
      if (fs.existsSync(segmentFilepath)) {
        console.log(`file already exists: ${segmentFilename}`);
      } else {
        while (1) {
          try {
            console.log(`downloading ${segmentFilename}`);
            await download(line, segmentFilepath);
            break;
          } catch (e) {
            console.error(e);
            continue;
          }
        }
      }
      newPlaylistDataLines.push(segmentFilepath);
    } else {
      newPlaylistDataLines.push(line);
    }
  }
  return newPlaylistDataLines.join("\n");
};

const readline = rl.createInterface({
  input: process.stdin,
  output: process.stdout,
});

readline.question("URL of master .m3u8: ", async (url) => {
  readline.question("Output file path: ", async (output) => {
    while (1) {
      try {
        // find host and filename from url
        const match = url.match(/(.*)\/(.*)$/);
        const host = match[1] + "/";
        const masterFilename = match[2];
        const masterFilepath = await download(
          url,
          path.join(__dirname, `./tmp/${masterFilename}`)
        );
        // read file and queue downloads of inner files
        const masterData = await readFile(masterFilepath);
        // find first playlist file
        const playlistFilename = scanMasterPlaylist(masterData);
        // download it
        const playlistFilepath = await download(
          `${host}/${playlistFilename}`,
          path.join(__dirname, `./tmp/${playlistFilename}`)
        );
        // read file
        const playlistData = await readFile(playlistFilepath);
        // download needed .ts files
        const newPlaylistData = await scanPlaylist(playlistData);
        const newPlaylistFilepath = await writeFile(
          newPlaylistData,
          `./tmp/local_${playlistFilename}`
        );
        console.log(`done writing to ${newPlaylistFilepath}`);
        const command = `ffmpeg -protocol_whitelist file,http,https,tcp,tls,crypto -i ${newPlaylistFilepath} -c copy "${output}"`;
        console.log(`now executing ${command}`);
        await new Promise((resolve, reject) => {
          exec(command, (error, stdout, stderr) => {
            if (error) reject(stderr);
            resolve(stdout);
          });
        });
        readline.close();
        break;
      } catch (e) {
        console.error(e);
        continue;
      }
    }
  });
});
