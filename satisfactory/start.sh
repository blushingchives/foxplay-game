#!/bin/bash

cd minecraft
mv ../server.properties .
mv ../RconMonitor.class .

java -cp . RconMonitor &

java -server -XX:+UseContainerSupport -XX:MaxRAMPercentage=90 -jar fabric-server-mc.jar nogui
