import requests, time, re

def get_magic_link(email_file):
    f = open(email