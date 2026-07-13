' Logger.brs
' Copyright (C) 2018 Rolando Islas
' Released under the MIT license
'
' Internal logging utility

' Initialize a logging utility
function Logger() as object
  log = {}
  log.FATAL = -2
  log.WARN = -1
  log.INFO = 0
  log.DEBUG = 1
  log.EXTRA = 2
  log.VERBOSE = 3

  ' Main

  ' Log a message
  ' @param level log level string or integer
  ' @param msg message to print
  log.printl = sub(level as object, msg as object)
    if m._parse_level(level) > m.log_level
      return
    end if
    ' bsc-disable-next-line print-locations
    print "[" + m._level_to_string(level) + "] " + msg
  end sub

  ' Parse level to a string
  ' @param level string or integer level
  log._level_to_string = function(level as object) as string
    if type(level) = "roString" or type(level) = "String"
      level = m._parse_level(level)
    end if
    if level = -2
      return "FATAL"
    else if level = -1
      return "WARN"
    else if level = 0
      return "INFO"
    else if level = 1
      return "DEBUG"
    else if level = 2
      return "EXTRA"
    else if level = 3
      return "VERBOSE"
    end if
    ' JellyRock: explicit fallback so every path returns a string (was an implicit invalid return).
    return "?"
  end function

  ' Parse level to an integer
  ' @param level string or integer level
  log._parse_level = function(level as object) as integer
    level_string = level.toStr()
    log_level = 0
    if level_string = "FATAL" or level_string = "-2"
      log_level = m.FATAL
    else if level_string = "WARN" or level_string = "-1"
      log_level = m.WARN
    else if level_string = "INFO" or level_string = "0"
      log_level = m.INFO
    else if level_string = "DEBUG" or level_string = "1"
      log_level = m.DEBUG
    else if level_string = "EXTRA" or level_string = "2"
      log_level = m.EXTRA
    else if level_string = "VERBOSE" or level_string = "3"
      log_level = m.VERBOSE
    end if
    return log_level
  end function

  ' Set the log level
  log.set_log_level = sub(level as string)
    m.log_level = m._parse_level(level)
  end sub

  ' JellyRock modification: default the log level to INFO instead of reading an optional
  ' pkg:/bright_web_socket.json config (JellyRock doesn't ship one — the upstream read
  ' spammed ReadAsciiFile/ParseJSON errors + a WARN on every socket open).
  log.log_level = log.INFO
  return log
end function
