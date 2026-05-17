#!/bin/bash

cd /hytale

# Download the Hytale downloader if not present
if [[ ! -d downloader ]]; then
    wget -q -O /tmp/hytale-downloader.zip https://downloader.hytale.com/hytale-downloader.zip
    unzip -q /tmp/hytale-downloader.zip -d downloader
    rm /tmp/hytale-downloader.zip
fi

# Download or update server files
./downloader/hytale-downloader download --output /hytale

# Start server
exec java -server $JAVA_OPTS -XX:+UseContainerSupport -XX:MaxRAMPercentage=90 -jar HytaleServer.jar
