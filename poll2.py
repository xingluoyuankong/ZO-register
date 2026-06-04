import requests, time, re, sys

def poll_magic_link(email_file):
    with open(email_file) as f:
        raw =