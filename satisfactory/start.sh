#!/bin/bash

: ${Port:?Port is required}
: ${ReliablePort:?ReliablePort is required}

exec /home/steam/SatisfactoryDedicatedServer/FactoryServer.sh \
    -Port=$Port \
    -ReliablePort=$ReliablePort \
    -ExternalReliablePort=$ReliablePort
