' ByteUtil.brs
' Copyright (C) 2018 Rolando Islas
' Released under the MIT license
'
' Byte array operation related utilities

' Convert network ordered bytes to a short (16-bit int)
function bytes_to_short(b1 as integer, b2 as integer) as integer
  return ((b1 and &hff) << 8) or (b2 and &hff)
end function

' Convert network ordered bytes to a long (64-bit int)
function bytes_to_long(b1 as integer, b2 as integer, b3 as integer, b4 as integer, b5 as integer, b6 as integer, b7 as integer, b8 as integer) as longinteger
  return ((b1 and &hff) << 24) or ((b2 and &hff) << 16) or ((b3 and &hff) << 8) or (b4 and &hff) or ((b5 and &hff) << 24) or ((b6 and &hff) << 16) or ((b7 and &hff) << 8) or (b8 and &hff)
end function

' Convert a 32-bit int to a roByteArray
' Bytes are network ordered
function int_to_bytes(number as integer) as object
  ba = createObject("roByteArray")
  if ba.isLittleEndianCPU()
    for bit = 24 to 0 step -8
      ba.push((number >> bit) and &hff)
    end for
  else
    for bit = 0 to 24 step 8
      ba.push((number >> bit) and &hff)
    end for
  end if
  return ba
end function

' Convert a 16-bit int to a roByteArray
' Bytes are network ordered
function short_to_bytes(number as integer) as object
  ba = createObject("roByteArray")
  if ba.isLittleEndianCPU()
    ba.push((number >> 8) and &hff)
    ba.push(number)
  else
    ba.push(number)
    ba.push((number >> 8) and &hff)
  end if
  return ba
end function

' Convert a 64-bit int to a roByteArray
' Bytes are network ordered
' FIXME bitwise operations on numbers larger than 0xffffffff (max 32-bit)
'       are problematic even when specifying longinteger
function long_to_bytes(number as longinteger) as object
  ba = createObject("roByteArray")
  if ba.isLittleEndianCPU()
    for bit = 7 to 0 step -1
      ba[bit] = (number and &hff)
      number >>= 8
    end for
  else
    for bit = 0 to 56 step 8
      ba.push((number >> bit) and &hff)
    end for
  end if
  return ba
end function

' Perform a bitwise exclusive or on two integers
function xor(a as integer, b as integer) as integer
  return (a or b) and not (a and b)
end function
