/*
 * Embedded C programs.
 *
 * `expected` is the exact stdout each program must produce; the test suite
 * runs every program through the simulator and compares against it.
 */
(function (root, factory) {
  const ns = (root.CViz = root.CViz || {});
  factory(ns);
  if (typeof module === 'object' && module.exports) module.exports = ns;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (CViz) {
  'use strict';

  const Programs = [
    {
      id: 'leap-year',
      title: 'Leap Year Check',
      summary: 'An array of years, a loop, and one call frame per check.',
      stdin: '',
      source: `#include <stdio.h>

/* A year is a leap year when it is divisible by 4,
   except century years, which must be divisible by 400. */
int isLeapYear(int year) {
    if (year % 400 == 0) {
        return 1;
    }
    if (year % 100 == 0) {
        return 0;
    }
    if (year % 4 == 0) {
        return 1;
    }
    return 0;
}

int main() {
    int years[5] = {1900, 2000, 2023, 2024, 2100};
    int count = 5;
    int leapCount = 0;

    for (int i = 0; i < count; i++) {
        int year = years[i];
        if (isLeapYear(year)) {
            printf("%d is a leap year\\n", year);
            leapCount++;
        } else {
            printf("%d is not a leap year\\n", year);
        }
    }

    printf("%d of %d years are leap years\\n", leapCount, count);
    return 0;
}
`,
      expected:
        '1900 is not a leap year\n' +
        '2000 is a leap year\n' +
        '2023 is not a leap year\n' +
        '2024 is a leap year\n' +
        '2100 is not a leap year\n' +
        '2 of 5 years are leap years\n',
    },

    {
      id: 'prime',
      title: 'Prime Number Check',
      summary: 'Reads a number with scanf and reports a divisor through a pointer.',
      stdin: '91',
      source: `#include <stdio.h>

/* Returns 1 when n is prime. When it is not, the smallest
   divisor is written through the pointer \`divisor\`. */
int isPrime(int n, int *divisor) {
    if (n < 2) {
        *divisor = 0;
        return 0;
    }
    for (int i = 2; i * i <= n; i++) {
        if (n % i == 0) {
            *divisor = i;
            return 0;
        }
    }
    return 1;
}

int main() {
    int n;
    int divisor = 0;

    printf("Enter a number: ");
    scanf("%d", &n);

    if (isPrime(n, &divisor)) {
        printf("%d is a prime number\\n", n);
    } else if (divisor == 0) {
        printf("%d is not prime (primes start at 2)\\n", n);
    } else {
        printf("%d is not prime: %d x %d = %d\\n", n, divisor, n / divisor, n);
    }
    return 0;
}
`,
      expected: 'Enter a number: 91 is not prime: 7 x 13 = 91\n',
    },

    {
      id: 'armstrong',
      title: 'Armstrong Number Generator',
      summary: 'Nested calls three frames deep; results are collected in a heap array.',
      stdin: '',
      source: `#include <stdio.h>
#include <stdlib.h>

/* An Armstrong number equals the sum of its own digits,
   each raised to the power of the digit count:
   153 = 1^3 + 5^3 + 3^3 */

int countDigits(int n) {
    int count = 0;
    while (n > 0) {
        count++;
        n /= 10;
    }
    return count;
}

int power(int base, int exp) {
    int result = 1;
    for (int i = 0; i < exp; i++) {
        result *= base;
    }
    return result;
}

int isArmstrong(int n) {
    int digits = countDigits(n);
    int sum = 0;
    int temp = n;
    while (temp > 0) {
        int digit = temp % 10;
        sum += power(digit, digits);
        temp /= 10;
    }
    return sum == n;
}

int main() {
    int limit = 500;
    int capacity = 16;
    int found = 0;
    int *results = malloc(capacity * sizeof(int));

    for (int n = 1; n <= limit; n++) {
        if (isArmstrong(n)) {
            results[found] = n;
            found++;
        }
    }

    printf("Armstrong numbers up to %d:\\n", limit);
    for (int i = 0; i < found; i++) {
        printf("%d ", results[i]);
    }
    printf("\\nfound %d numbers\\n", found);

    free(results);
    return 0;
}
`,
      expected:
        'Armstrong numbers up to 500:\n' +
        '1 2 3 4 5 6 7 8 9 153 370 371 407 \n' +
        'found 13 numbers\n',
    },

    {
      id: 'palindrome',
      title: 'String Palindrome',
      summary: 'Two char pointers walk toward each other across a heap string.',
      stdin: '',
      source: `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>

/* Copies only the letters and digits of \`text\`, lower-cased,
   into a new heap buffer. The caller must free() it. */
char *normalize(char *text) {
    int length = strlen(text);
    char *clean = malloc(length + 1);
    int j = 0;
    for (int i = 0; i < length; i++) {
        if (isalnum(text[i])) {
            clean[j] = tolower(text[i]);
            j++;
        }
    }
    clean[j] = '\\0';
    return clean;
}

/* Walks two pointers toward each other from both ends. */
int isPalindrome(char *str) {
    char *left = str;
    char *right = str + strlen(str) - 1;
    while (left < right) {
        if (*left != *right) {
            return 0;
        }
        left++;
        right--;
    }
    return 1;
}

int main() {
    char phrase[] = "Race Car";
    char *clean = normalize(phrase);

    if (isPalindrome(clean)) {
        printf("\\"%s\\" is a palindrome\\n", phrase);
    } else {
        printf("\\"%s\\" is not a palindrome\\n", phrase);
    }

    free(clean);
    return 0;
}
`,
      expected: '"Race Car" is a palindrome\n',
    },

    {
      id: 'perfect',
      title: 'Perfect Number Logic',
      summary: 'Sums proper divisors in a helper function for every candidate.',
      stdin: '',
      source: `#include <stdio.h>

/* A perfect number equals the sum of its proper divisors:
   28 = 1 + 2 + 4 + 7 + 14 */
int sumOfDivisors(int n) {
    int sum = 0;
    for (int i = 1; i <= n / 2; i++) {
        if (n % i == 0) {
            sum += i;
        }
    }
    return sum;
}

int isPerfect(int n) {
    if (n < 2) {
        return 0;
    }
    return sumOfDivisors(n) == n;
}

int main() {
    int limit = 30;
    int count = 0;

    printf("Perfect numbers up to %d:\\n", limit);
    for (int n = 1; n <= limit; n++) {
        if (isPerfect(n)) {
            printf("%d is perfect\\n", n);
            count++;
        }
    }

    printf("found %d perfect numbers\\n", count);
    return 0;
}
`,
      expected:
        'Perfect numbers up to 30:\n' +
        '6 is perfect\n' +
        '28 is perfect\n' +
        'found 2 perfect numbers\n',
    },

    {
      id: 'linked-list',
      title: 'Linked List on the Heap',
      summary: 'Structs allocated with malloc and chained together by pointers.',
      stdin: '',
      source: `#include <stdio.h>
#include <stdlib.h>

struct Node {
    int value;
    struct Node *next;
};

/* Allocates a node on the heap and links it in front of \`head\`. */
struct Node *push(struct Node *head, int value) {
    struct Node *node = malloc(sizeof(struct Node));
    node->value = value;
    node->next = head;
    return node;
}

int sum(struct Node *head) {
    int total = 0;
    struct Node *cur = head;
    while (cur != NULL) {
        total += cur->value;
        cur = cur->next;
    }
    return total;
}

void freeList(struct Node *head) {
    while (head != NULL) {
        struct Node *next = head->next;
        free(head);
        head = next;
    }
}

int main() {
    struct Node *list = NULL;

    for (int i = 1; i <= 4; i++) {
        list = push(list, i * 10);
    }

    printf("sum = %d\\n", sum(list));

    freeList(list);
    list = NULL;
    return 0;
}
`,
      expected: 'sum = 100\n',
    },

    {
      id: 'recursion',
      title: 'Recursion and Pointer Swap',
      summary: 'A recursive factorial stacks five frames; swap() writes through pointers.',
      stdin: '',
      source: `#include <stdio.h>

/* Each recursive call pushes a new frame; the frames unwind
   in reverse order once the base case returns. */
int factorial(int n) {
    if (n <= 1) {
        return 1;
    }
    int rest = factorial(n - 1);
    return n * rest;
}

void swap(int *a, int *b) {
    int temp = *a;
    *a = *b;
    *b = temp;
}

int main() {
    int x = 5;
    int y = factorial(x);
    printf("%d! = %d\\n", x, y);

    swap(&x, &y);
    printf("after swap: x = %d, y = %d\\n", x, y);
    return 0;
}
`,
      expected: '5! = 120\nafter swap: x = 120, y = 5\n',
    },
  ];

  CViz.Programs = Programs;
});
