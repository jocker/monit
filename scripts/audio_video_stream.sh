#!/bin/bash -e

serverIp=$(ifconfig | grep -E 'inet.[0-9]' | grep -v '127.0.0.1' | awk '{ print $2}')
clientIp=$(echo $serverIp | cut -d '.' -f 1-3).255 # Send to all

gst-launch-1.0 -v alsasrc device=plughw:Set \
! mulawenc ! rtppcmupay ! udpsink host=$clientIp port=5001 &

raspivid -t 999999 -w 1080 -h 720 -fps 25 -hf -b 2000000 -o - | \
gst-launch-1.0 -v fdsrc ! h264parse ! rtph264pay config-interval=1 pt=96 \
! gdppay ! tcpserversink host=$serverIp port=5000

kill $!
